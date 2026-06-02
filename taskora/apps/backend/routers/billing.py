from typing import Literal
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from supabase import Client
from pydantic import BaseModel
from auth import get_current_user
from deps import get_supabase, require_member
from config import get_settings, Settings
from automation import events as ev

router = APIRouter(prefix="/api/v1/billing", tags=["billing"])

PLAN_RAZORPAY_IDS: dict[str, str] = {
    "pro": "plan_pro_monthly",
    "business": "plan_biz_monthly",
}
PLAN_MRR_INR: dict[str, int] = {"pro": 999, "business": 2999}


class CreateSubscription(BaseModel):
    business_id: str
    plan: Literal["pro", "business"]
    billing_cycle: Literal["monthly", "annual"] = "monthly"
    currency: Literal["INR", "USD", "GBP", "EUR"] = "INR"


@router.post("/subscribe", status_code=201)
def create_subscription(
    body: CreateSubscription,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
    settings: Settings = Depends(get_settings),
):
    require_member(sb, body.business_id, user["id"])

    trial_start = datetime.now(timezone.utc)
    trial_end = trial_start + timedelta(days=60)
    sub_row = {
        "business_id": body.business_id,
        "plan": body.plan,
        "status": "trialing",
        "billing_cycle": body.billing_cycle,
        "trial_start": trial_start.isoformat(),
        "trial_end": trial_end.isoformat(),
    }

    if body.currency == "INR":
        if not settings.razorpay_key_id or not settings.razorpay_key_secret:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                                detail="Razorpay not configured")
        import razorpay
        rz = razorpay.Client(auth=(settings.razorpay_key_id, settings.razorpay_key_secret))
        rz_sub = rz.subscription.create({
            "plan_id": PLAN_RAZORPAY_IDS[body.plan],
            "customer_notify": 1,
            "quantity": 1,
            "total_count": 12 if body.billing_cycle == "annual" else 120,
        })
        sub_row["razorpay_subscription_id"] = rz_sub["id"]
        sb.table("subscriptions").upsert(sub_row).execute()
        return {"razorpay_subscription_id": rz_sub["id"], "razorpay_key": settings.razorpay_key_id}
    else:
        if not settings.stripe_secret_key:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                                detail="Stripe not configured")
        import stripe as stripe_lib
        stripe_lib.api_key = settings.stripe_secret_key
        customer = stripe_lib.Customer.create(email=user["email"])
        price_id = f"price_stripe_{body.plan}_{body.billing_cycle}"
        stripe_sub = stripe_lib.Subscription.create(
            customer=customer.id,
            items=[{"price": price_id}],
            trial_period_days=60,
        )
        sub_row["stripe_subscription_id"] = stripe_sub.id
        sb.table("subscriptions").upsert(sub_row).execute()
        return {"stripe_client_secret": stripe_sub.latest_invoice.payment_intent.client_secret}


@router.post("/razorpay-webhook")
async def razorpay_webhook(
    request: Request,
    settings: Settings = Depends(get_settings),
    sb: Client = Depends(get_supabase),
):
    if not settings.razorpay_key_secret:
        raise HTTPException(status_code=400, detail="Webhook not configured")
    import razorpay
    rz = razorpay.Client(auth=(settings.razorpay_key_id, settings.razorpay_key_secret))

    payload = await request.body()
    signature = request.headers.get("X-Razorpay-Signature", "")
    try:
        rz.utility.verify_webhook_signature(payload.decode(), signature, settings.razorpay_key_secret)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid webhook signature")

    event = await request.json()
    event_name = event.get("event", "")
    sub_entity = event.get("payload", {}).get("subscription", {}).get("entity", {})
    sub_id = sub_entity.get("id")

    def _biz_for_sub() -> str | None:
        rows = sb.table("subscriptions").select("business_id").eq("razorpay_subscription_id", sub_id).limit(1).execute().data
        return rows[0]["business_id"] if rows else None

    now_iso = datetime.now(timezone.utc).isoformat()

    if event_name == "subscription.activated":
        sb.table("subscriptions").update({"status": "active"}).eq("razorpay_subscription_id", sub_id).execute()
        ev.emit(sb, ev.SUBSCRIBED, business_id=_biz_for_sub(), props={"rz_event": event_name})
    elif event_name == "subscription.charged":
        # Successful (renewal) charge → active, advance period, clear dunning.
        patch = {"status": "active"}
        period_end = sub_entity.get("current_end") or sub_entity.get("charge_at")
        if period_end:
            try:
                patch["current_period_end"] = datetime.fromtimestamp(int(period_end), tz=timezone.utc).isoformat()
            except Exception:
                pass
        sb.table("subscriptions").update(patch).eq("razorpay_subscription_id", sub_id).execute()
        ev.emit(sb, ev.PAYMENT_SUCCEEDED, business_id=_biz_for_sub(), props={"rz_event": event_name})
    elif event_name in ("subscription.pending", "subscription.halted"):
        # Razorpay couldn't collect → past_due drives the dunning scan.
        # current_period_end marks when collection failed (the dunning clock).
        sb.table("subscriptions").update(
            {"status": "past_due", "current_period_end": now_iso}
        ).eq("razorpay_subscription_id", sub_id).execute()
        ev.emit(sb, ev.PAYMENT_FAILED, business_id=_biz_for_sub(), props={"rz_event": event_name})
    elif event_name == "subscription.cancelled":
        sb.table("subscriptions").update({"status": "cancelled"}).eq("razorpay_subscription_id", sub_id).execute()

    return {"ok": True}


@router.get("/status/{business_id}")
def get_subscription_status(
    business_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    require_member(sb, business_id, user["id"])
    rows = (
        sb.table("subscriptions")
        .select("*")
        .eq("business_id", business_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
        .data
    )
    if not rows:
        return {"plan": "free", "status": "none"}
    return rows[0]
