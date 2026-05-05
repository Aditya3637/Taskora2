-- Fix create_trial_subscription trigger function.
-- Migration 007 incorrectly referenced amount_inr (a column on invoices, not subscriptions)
-- and used ON CONFLICT (business_id) without a backing unique constraint.

CREATE OR REPLACE FUNCTION create_trial_subscription()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO subscriptions (
    business_id, plan, status,
    trial_start, trial_end,
    billing_cycle
  ) VALUES (
    NEW.id, 'free', 'trialing',
    now(), now() + interval '60 days',
    'monthly'
  );
  RETURN NEW;
END;
$$;
