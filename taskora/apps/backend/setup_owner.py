"""
One-time setup script: make engineeradityasingh@gmail.com the platform owner
with admin access, sales leads visibility, and persona-switching capability.
"""

import sys
import os
import uuid
import json

sys.path.insert(0, os.path.dirname(__file__))
os.chdir(os.path.dirname(__file__))

from config import get_settings
from supabase import create_client

TARGET_EMAIL = "engineeradityasingh@gmail.com"
BUSINESS_NAME = "Taskora HQ"

settings = get_settings()
sb = create_client(settings.supabase_url, settings.supabase_service_key)

# ── 1. Find or create auth user ───────────────────────────────────────────────
print(f"\n[1] Looking up auth user: {TARGET_EMAIL}")
try:
    auth_users = sb.auth.admin.list_users()
    target_auth = next((u for u in auth_users if u.email == TARGET_EMAIL), None)
except Exception as e:
    print(f"  Could not list auth users: {e}")
    target_auth = None

if target_auth is None:
    print("  User not found in auth — creating...")
    result = sb.auth.admin.create_user({
        "email": TARGET_EMAIL,
        "email_confirm": True,
        "password": "Taskora@2025!",
    })
    user_id = result.user.id
    print(f"  Created auth user: {user_id}")
else:
    user_id = target_auth.id
    print(f"  Found auth user: {user_id}")

# ── 2. Update auth user_metadata so the frontend nav shows Admin link ─────────
print(f"\n[2] Updating auth user_metadata with is_admin=true...")
sb.auth.admin.update_user_by_id(user_id, {
    "user_metadata": {
        "is_admin": True,
        "persona_switching": True,
        "can_access_sales_leads": True,
        "can_access_sales_pipeline": True,
    }
})
print("  Done.")

# ── 2b. Upsert into public.users with is_admin=true ──────────────────────────
print(f"\n[2b] Upserting public.users with admin flag...")
sb.table("users").upsert({
    "id": user_id,
    "email": TARGET_EMAIL,
    "name": "Aditya Singh",
    "settings": {
        "is_admin": True,
        "persona_switching": True,
        "can_access_sales_leads": True,
        "can_access_sales_pipeline": True,
    },
}, on_conflict="id").execute()
print("  Done.")

# ── 3. Find or create Taskora HQ business ─────────────────────────────────────
print(f"\n[3] Checking for existing business owned by user...")
existing = sb.table("businesses").select("*").eq("owner_id", user_id).execute()

if existing.data:
    business_id = existing.data[0]["id"]
    print(f"  Found existing business: {existing.data[0]['name']} ({business_id})")
else:
    business_id = str(uuid.uuid4())
    sb.table("businesses").insert({
        "id": business_id,
        "name": BUSINESS_NAME,
        "type": "client",
        "owner_id": user_id,
    }).execute()
    print(f"  Created business '{BUSINESS_NAME}': {business_id}")

# ── 4. Ensure owner membership ────────────────────────────────────────────────
print(f"\n[4] Setting owner role in business_members...")
existing_member = (
    sb.table("business_members")
    .select("*")
    .eq("business_id", business_id)
    .eq("user_id", user_id)
    .execute()
)
if existing_member.data:
    sb.table("business_members").update({"role": "owner"}).eq("business_id", business_id).eq("user_id", user_id).execute()
    print("  Updated existing membership to owner.")
else:
    sb.table("business_members").insert({
        "business_id": business_id,
        "user_id": user_id,
        "role": "owner",
    }).execute()
    print("  Inserted owner membership.")

# ── 5. Create test personas ───────────────────────────────────────────────────
PERSONAS = [
    {"email": "persona.sales@taskora.test",    "name": "Sales Rep",      "role": "member"},
    {"email": "persona.manager@taskora.test",  "name": "Team Manager",   "role": "owner"},
    {"email": "persona.viewer@taskora.test",   "name": "Read-Only User", "role": "member"},
    {"email": "persona.client@taskora.test",   "name": "Client Contact", "role": "member"},
]

print(f"\n[5] Setting up test personas...")
for p in PERSONAS:
    try:
        existing_p = next((u for u in auth_users if u.email == p["email"]), None) if auth_users else None
    except Exception:
        existing_p = None

    if existing_p is None:
        try:
            res = sb.auth.admin.create_user({
                "email": p["email"],
                "email_confirm": True,
                "password": "Taskora@2025!",
            })
            pid = res.user.id
            print(f"  Created persona: {p['name']} ({p['email']}) → {pid}")
        except Exception as e:
            print(f"  Skipping {p['email']}: {e}")
            continue
    else:
        pid = existing_p.id
        print(f"  Existing persona: {p['name']} ({p['email']}) → {pid}")

    # Add to public.users
    sb.table("users").upsert({
        "id": pid,
        "email": p["email"],
        "name": p["name"],
        "settings": {"persona": True, "persona_role": p["role"]},
    }, on_conflict="id").execute()

    # Add to same business
    existing_pm = (
        sb.table("business_members")
        .select("*")
        .eq("business_id", business_id)
        .eq("user_id", pid)
        .execute()
    )
    if existing_pm.data:
        sb.table("business_members").update({"role": p["role"]}).eq("business_id", business_id).eq("user_id", pid).execute()
    else:
        sb.table("business_members").insert({
            "business_id": business_id,
            "user_id": pid,
            "role": p["role"],
        }).execute()

print(f"\n✓ Setup complete!")
print(f"  Owner email : {TARGET_EMAIL}")
print(f"  Password    : Taskora@2025!")
print(f"  Business    : {BUSINESS_NAME} ({business_id})")
print(f"  Admin access: is_admin=true (sales leads, pipeline, admin routes)")
print(f"  Personas    : {len(PERSONAS)} test users created with same password")
