-- Allow 'revoked' as a workspace_invites.status value. The backend's
-- DELETE /invites/revoke/{id} has been writing this since invites Phase 1,
-- but the CHECK only listed pending/accepted/declined/expired, so every
-- Revoke click bubbled up as "a submitted value is not allowed". Add the
-- missing enum value semantically (revoke ≠ decline; the latter is the
-- invitee saying no, the former is the inviter taking it back).

BEGIN;

ALTER TABLE public.workspace_invites
  DROP CONSTRAINT IF EXISTS workspace_invites_status_check;

ALTER TABLE public.workspace_invites
  ADD CONSTRAINT workspace_invites_status_check
  CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'revoked'));

COMMIT;
