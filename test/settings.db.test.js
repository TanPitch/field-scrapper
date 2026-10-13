/* settings.db.test.js — the per-user settings tables, exercised against the real
 * database. No HTTP: this covers the schema, the rich-text validation and the
 * transactional replace, which is where the actual bugs live. The HTTP layer is
 * a thin wrapper over exactly these queries.
 *
 *   cd test; bun settings.db.test.js
 *
 * Skips (exit 0) when DATABASE_URL is unset or migration 009 has not run, so it
 * stays safe to run against a core-only database.
 */
import assert from "node:assert/strict";
import pg from "pg";
import { normStyle } from "../server/users.js";

const { Client } = pg;
const url = process.env.DATABASE_URL;
if (!url) {
    console.log("skip: DATABASE_URL not set");
    process.exit(0);
}

const client = new Client({ connectionString: url });
await client.connect();

let passed = 0;
const test = async (name, fn) => {
    try {
        await fn();
        passed++;
        console.log(`  ok  ${name}`);
    } catch (e) {
        console.error(`FAIL  ${name}\n      ${e.message}`);
        process.exitCode = 1;
    }
};

/* ------------------------------------------------------------- rich text */

await test("normStyle keeps only the six known keys", () => {
    assert.deepEqual(normStyle({ b: true, i: true, u: true, bg: "#f00", fg: "#00ff00", badge: "●" }),
        { b: true, i: true, u: true, bg: "#f00", fg: "#00ff00", badge: "●" });
    assert.deepEqual(normStyle({ evil: "<script>", onclick: "x" }), {});
});

await test("normStyle coerces truthy flags to real booleans", () => {
    assert.deepEqual(normStyle({ b: "yes", i: 1, u: 0 }), { b: true, i: true, u: false });
});

await test("normStyle rejects non-colour strings instead of storing them", () => {
    /* The renderer puts bg/fg straight into a style attribute. A value that is
     * not a colour must not survive, or that becomes a CSS injection point. */
    assert.deepEqual(normStyle({ bg: "red; background:url(http://x)" }), {});
    assert.deepEqual(normStyle({ fg: "expression(alert(1))" }), {});
});

await test("normStyle caps badge length so a label cannot flood its cell", () => {
    assert.deepEqual(normStyle({ badge: "🙂🙂🙂🙂🙂🙂🙂" }), { badge: "🙂🙂🙂🙂" });
});

await test("normStyle survives junk input", () => {
    for (const junk of [null, undefined, 42, "str", [1, 2]]) {
        assert.deepEqual(normStyle(junk), {});
    }
});

/* --------------------------------------------------------------- schema */

const have = await client.query(
    `SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema='public' AND table_name IN
            ('app_users','user_prefs','user_table_columns','user_layers')`);
if (have.rows[0].n < 4) {
    console.log("skip: migration 009 not applied");
    await client.end();
    process.exit(0);
}

/* One throwaway user per run, removed at the end. Deleting it cascades to every
 * child table, so the test never leaves settings behind. */
const hash = await Bun.password.hash("test-password-123", { algorithm: "argon2id" });
const { rows: created } = await client.query(
    `INSERT INTO app_users (username, password_hash, display_name)
     VALUES ($1,$2,$3) RETURNING id`,
    [`settings_test_${Date.now()}`, hash, "Settings Test"]);
const uid = created[0].id;

try {
    await test("register stores an argon2id hash, not the password", async () => {
        const { rows } = await client.query(`SELECT password_hash FROM app_users WHERE id=$1`, [uid]);
        assert.match(rows[0].password_hash, /^\$argon2id\$/);
        assert.ok(!rows[0].password_hash.includes("test-password-123"));
        assert.ok(await Bun.password.verify("test-password-123", rows[0].password_hash));
    });

    await test("username is unique", async () => {
        const { rows } = await client.query(`SELECT username FROM app_users WHERE id=$1`, [uid]);
        await assert.rejects(
            client.query(`INSERT INTO app_users (username,password_hash) VALUES ($1,$2)`,
                [rows[0].username, hash]),
            (e) => e.code === "23505");
    });

    await test("prefs upsert round-trip and are scoped per user", async () => {
        for (const [k, v] of [["theme", "dark"], ["mapStyle", "liberty"], ["units", "sqwa"]]) {
            await client.query(
                `INSERT INTO user_prefs (user_id,key,value) VALUES ($1,$2,$3)
                 ON CONFLICT (user_id,key) DO UPDATE SET value=excluded.value`,
                [uid, k, JSON.stringify(v)]);
        }
        const { rows } = await client.query(`SELECT key,value FROM user_prefs WHERE user_id=$1`, [uid]);
        const prefs = Object.fromEntries(rows.map((r) => [r.key, r.value]));
        assert.equal(prefs.theme, "dark");
        assert.equal(prefs.units, "sqwa");

        await client.query(
            `INSERT INTO user_prefs (user_id,key,value) VALUES ($1,'theme',$2)
             ON CONFLICT (user_id,key) DO UPDATE SET value=excluded.value`,
            [uid, JSON.stringify("light")]);
        const after = await client.query(`SELECT value FROM user_prefs WHERE user_id=$1 AND key='theme'`, [uid]);
        assert.equal(after.rows[0].value, "light");
    });

    await test("table columns keep order, pin, width and rich text", async () => {
        const cols = [
            { key: "deed", label: "โฉนด", visible: true, pinned: true, order: 0, width: 120, style: { b: true, badge: "⚖" } },
            { key: "price", label: "ราคา", visible: true, pinned: false, order: 1, width: 200, style: { fg: "#16a34a" } },
            { key: "name", label: null, visible: true, pinned: false, order: 2, width: null, style: {} },
            { key: "hidden", label: "x", visible: false, pinned: false, order: 3, width: null, style: {} },
        ];
        for (const c of cols) {
            await client.query(
                `INSERT INTO user_table_columns
                    (user_id,table_key,column_key,label,style,visible,pinned,sort_order,width)
                 VALUES ($1,'lots',$2,$3,$4,$5,$6,$7,$8)`,
                [uid, c.key, c.label, JSON.stringify(c.style), c.visible, c.pinned, c.order, c.width]);
        }
        const { rows } = await client.query(
            `SELECT * FROM user_table_columns WHERE user_id=$1 AND table_key='lots' ORDER BY sort_order`, [uid]);
        assert.equal(rows.length, 4);
        assert.equal(rows[0].column_key, "deed");
        assert.equal(rows[0].pinned, true);
        assert.deepEqual(rows[0].style, { b: true, badge: "⚖" });
        assert.equal(rows[3].visible, false);
    });

    await test("same column key in a different table does not collide", async () => {
        await client.query(
            `INSERT INTO user_table_columns (user_id,table_key,column_key,label)
             VALUES ($1,'map','deed','Map Deed')`, [uid]);
        const { rows } = await client.query(
            `SELECT table_key FROM user_table_columns WHERE user_id=$1 AND column_key='deed'`, [uid]);
        assert.deepEqual(rows.map((r) => r.table_key).sort(), ["lots", "map"]);
    });

    await test("layers hold drawings and display areas with names and notes", async () => {
        const layers = [
            { id: "d1", kind: "drawing", geom: "line", name: "ถนนเข้าพื้นที่", note: "กว้าง 6 ม.", style: { b: true, fg: "#dc2626" } },
            { id: "d2", kind: "drawing", geom: "circle", name: "รัศมี 500 ม.", note: null, style: {} },
            { id: "a1", kind: "display_area", geom: "polygon", name: "โซน A", note: "ทดลอง", style: { u: true } },
        ];
        for (const l of layers) {
            await client.query(
                `INSERT INTO user_layers (user_id,layer_id,kind,geom_type,name,note,style,geometry)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                [uid, l.id, l.kind, l.geom, l.name, l.note,
                    JSON.stringify(l.style), JSON.stringify({ type: "LineString", coordinates: [[100, 16], [101, 17]] })]);
        }
        const { rows } = await client.query(
            `SELECT * FROM user_layers WHERE user_id=$1 ORDER BY kind, id`, [uid]);
        assert.equal(rows.length, 3);
        assert.equal(rows.filter((r) => r.kind === "drawing").length, 2);
        assert.equal(rows.filter((r) => r.kind === "display_area").length, 1);
        assert.deepEqual(rows.find((r) => r.layer_id === "a1").style, { u: true });
    });

    await test("layer upsert updates in place, keeping the id", async () => {
        await client.query(
            `UPDATE user_layers SET name=$3, note=$4, updated_at=now()
              WHERE user_id=$1 AND layer_id=$2`, [uid, "d1", "ถนนหลัก", "แก้ไขแล้ว"]);
        const { rows } = await client.query(
            `SELECT name,note FROM user_layers WHERE user_id=$1 AND layer_id='d1'`, [uid]);
        assert.equal(rows[0].name, "ถนนหลัก");
        assert.equal(rows[0].note, "แก้ไขแล้ว");
        const { rows: n } = await client.query(
            `SELECT count(*)::int AS n FROM user_layers WHERE user_id=$1`, [uid]);
        assert.equal(n[0].n, 3);
    });

    await test("layer rejects a kind outside drawing/display_area", async () => {
        await assert.rejects(
            client.query(
                `INSERT INTO user_layers (user_id,layer_id,kind) VALUES ($1,'bad','nonsense')`, [uid]),
            (e) => e.code === "23514");
    });

    await test("one layer_id per user, reused as an upsert key", async () => {
        const { rows } = await client.query(
            `INSERT INTO user_layers (user_id,layer_id,kind,geom_type,name)
             VALUES ($1,'d1','drawing','line','ignored')
             ON CONFLICT (user_id,layer_id) DO UPDATE SET name=excluded.name
             RETURNING name`, [uid]);
        assert.equal(rows[0].name, "ignored");
    });

    await test("deleting the user cascades to every settings table", async () => {
        await client.query(`DELETE FROM app_users WHERE id=$1`, [uid]);
        for (const t of ["user_prefs", "user_table_columns", "user_layers"]) {
            const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${t} WHERE user_id=$1`, [uid]);
            assert.equal(rows[0].n, 0, `${t} should be empty after cascade`);
        }
    });

    await test("lot status accepts inactive and rejects anything else", async () => {
        /* Exercises the constraint with real rows. Reading pg_get_constraintdef
         * back would pass even if the constraint were never enforced. */
        const { rows: prov } = await client.query(`SELECT code FROM provinces LIMIT 1`);
        /* Unique deed per run: a previous run that died mid-test leaves its
         * fixture behind, and the next run must not collide with it. */
        const { rows: par } = await client.query(
            `INSERT INTO parcels (province_code, district_dol_code, deed_number, first_seen, last_seen)
             VALUES ($1,1,$2,now(),now()) RETURNING id`,
            [prov[0].code, `inactive-test-${Date.now()}`]);
        const pid = par[0].id;

        const base = (status) => ({
            text: `INSERT INTO auction_lots
                      (parcel_id, case_no, case_year, first_round_date, order_label, close_reason, status)
                   VALUES ($1,'T',2569,now(),'1','withdrawn',$2) RETURNING id`,
            values: [pid, status],
        });

        const ok = base("inactive");
        const { rows } = await client.query(ok.text, ok.values);
        assert.equal(rows[0].id > 0, true);

        /* Each bad value is rejected for its own reason: NULL hits the NOT NULL
         * column (23502), anything else hits the CHECK (23514). Asserting on the
         * specific code catches a value that is rejected for an accidental
         * reason instead of the one being tested. */
        const cases = [["bogus", "23514"], ["ACTIVE", "23514"], ["", "23514"], [null, "23502"]];
        for (const [bad, wantCode] of cases) {
            const q = base(bad);
            let code = null;
            try {
                await client.query(q.text, q.values);
            } catch (e) {
                code = e.code;
            }
            assert.equal(code, wantCode, `status ${JSON.stringify(bad)} should fail ${wantCode}, got ${code}`);
        }

        /* auction_lots -> parcels is a plain FK with no cascade, so the lots go
         * first. Leaving fixtures behind would poison the next run. */
        await client.query(`DELETE FROM auction_rounds WHERE lot_id IN (SELECT id FROM auction_lots WHERE parcel_id=$1)`, [pid]);
        await client.query(`DELETE FROM auction_lots WHERE parcel_id=$1`, [pid]);
        await client.query(`DELETE FROM parcels WHERE id=$1`, [pid]);
    });
} finally {
    await client.query(`DELETE FROM app_users WHERE id=$1`, [uid]).catch(() => {});
    await client.end();
}

console.log(`\n${passed} passed${process.exitCode ? ", with failures" : ""}`);
