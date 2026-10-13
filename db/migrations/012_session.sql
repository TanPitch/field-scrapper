-- 012_session.sql — the table express-session stores its sessions in.
--
-- connect-pg-simple CAN create this itself (createTableIfMissing, on by
-- default), but it does so lazily on first use, which means the very first
-- request after a fresh database fails with `relation "session" does not exist`
-- before the create lands. That is a bad first impression and an easy thing to
-- misdiagnose as a store or middleware problem.
--
-- Schema is copied verbatim from the package's own table.sql so there is no
-- drift: the library's create-if-missing will see the table, find it matches,
-- and move on.
--
-- Nothing here is worth querying directly — it is the session store's business.
-- It lives in migrations rather than in server/index.js so a fresh database
-- needs no warm-up request, and so `psql -f` is enough to prepare an environment.

BEGIN;

CREATE TABLE IF NOT EXISTS session (
    sid    varchar NOT NULL COLLATE "default",
    sess   json NOT NULL,
    expire timestamp(6) NOT NULL
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'session_pkey') THEN
        ALTER TABLE session ADD CONSTRAINT session_pkey
            PRIMARY KEY (sid) NOT DEFERRABLE INITIALLY IMMEDIATE;
    END IF;
END $$;

-- The store prunes expired rows on this index, so it is load-bearing rather
-- than decorative: without it every periodic prune is a sequential scan.
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON session (expire);

COMMIT;