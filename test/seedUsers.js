/* seedUsers.js — create the two demo accounts.
 *
 *   cd test; bun seedUsers.js
 *
 * Registration is open by default so a fresh install is usable, but that means
 * the accounts the app's own docs and the settings pane refer to do not exist
 * until someone types them into a form. `admin / admin1234` in particular is
 * referenced in RELEASE_NOTES and in the splash help text, so having it simply
 * not exist is a trap.
 *
 * Idempotent: re-running only creates what is missing, and will RESET the
 * password of an existing account only when RESET=1, so a user who has changed
 * their password does not silently lose it on the next seed run.
 */
import pg from "pg";
const { Client } = pg;

const url = process.env.DATABASE_URL;
if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
}

const ACCOUNTS = [
    { username: "admin", password: "admin1234", displayName: "admin", isAdmin: true },
    { username: "fieldscrapper", password: "user1234", displayName: "fieldscrapper", isAdmin: false },
];

const RESET = process.env.RESET === "1";
const client = new Client({ connectionString: url });
await client.connect();

try {
    for (const a of ACCOUNTS) {
        const { rows: existing } = await client.query(
            `SELECT id FROM app_users WHERE username = $1`, [a.username]);

        if (existing.length && !RESET) {
            const { rows } = await client.query(
                `UPDATE app_users SET display_name = $2, is_admin = $3 WHERE id = $1 RETURNING id`,
                [existing[0].id, a.displayName, a.isAdmin]);
            console.log(`  = ${a.username}  exists (id ${rows[0].id}) — password untouched${a.isAdmin ? '' : ''}`);
            continue;
        }

        const hash = await Bun.password.hash(a.password, { algorithm: "argon2id", memoryCost: 65536, timeCost: 3 });
        if (existing.length) {
            await client.query(
                `UPDATE app_users SET password_hash = $2, display_name = $3, is_admin = $4 WHERE id = $1`,
                [existing[0].id, hash, a.displayName, a.isAdmin]);
            console.log(`  ~ ${a.username}  password RESET`);
        } else {
            const { rows } = await client.query(
                `INSERT INTO app_users (username, password_hash, display_name, is_admin)
                 VALUES ($1, $2, $3, $4) RETURNING id`,
                [a.username, hash, a.displayName, a.isAdmin]);
            console.log(`  + ${a.username}  created (id ${rows[0].id})`);
        }
    }

    /* Prove the hashes verify, rather than assuming the encoding round-trips. */
    for (const a of ACCOUNTS) {
        const { rows } = await client.query(`SELECT password_hash FROM app_users WHERE username = $1`, [a.username]);
        const ok = rows[0] && await Bun.password.verify(a.password, rows[0].password_hash);
        console.log(`  verify ${a.username}: ${ok ? "ok" : "FAILED"}`);
    }
} finally {
    await client.end();
}