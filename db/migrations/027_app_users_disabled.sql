-- 027_app_users_disabled.sql — suspend an account without deleting it.
--
-- DELETE removes the user AND every pref/layout/annotation row that belongs to
-- them (they cascade). Disabling is the reversible middle ground for a user who
-- might come back: no sign-ins, history kept. The column lives on app_users
-- rather than in user_prefs because sign-in must consult it before any of the
-- per-user tables are even reachable.

BEGIN;

ALTER TABLE app_users ADD COLUMN IF NOT EXISTS disabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN app_users.disabled IS
    'Set by an admin to block sign-in without deleting the account and its settings. Sessions already open at the time are left alone until logout.';

COMMIT;
