/* resolveDolParcels.js - second stage of the cascade: DOL where TD has nothing.
 *
 * LED is the source of truth for what is being sold. TD is the primary
 * resolver; this runs only on parcels TD could not place.
 *
 * DOL is better than TD in three ways that matter here, and worse in one:
 *
 *   - parcellat/parcellon are real latitude and longitude. TD returns UTM that
 *     has to be inverted, and TD's DOL_SHAPE is the land office pin, not the
 *     parcel - byte-identical for every Phuket deed checked.
 *   - It is addressed as /{prov}/{amphur}/{parcelno} with the 2-digit amcode, so
 *     it filters by district server-side. TD cannot (AMPH_CODE is not a
 *     parameter), which is why 223 of 257 บึงกาฬ parcels needed client-side
 *     disambiguation and 7 came back in the wrong district.
 *   - It returns rai/ngan/wa/subwa, which is the check on LED's own figures.
 *     LED says 0-1-46.60 ตร.วา for deed 35032; DOL says 0 / 1 / 46 / 6 = 46.6.
 *   - But the quota is 20 calls a day, enforced server-side. Verified live:
 *     "เกินจำกัด 20 /วัน". test/research/dol_api_bundle/README.md states there
 *     is no quota; that is wrong, and dol_quota_ledger is the constraint that
 *     keeps us inside it.
 *
 * DOL uses TD's province numbering, not LED's: บึงกาฬ is 38 here and on TD,
 * while LED says 97. districts.td_province_code already carries that, so nothing
 * new is mapped here.
 *
 *   bun resolveDolParcels.js                 # dry run
 *   bun resolveDolParcels.js --write         # commit, respecting the quota
 *   bun resolveDolParcels.js --limit=5 --write
 *   bun resolveDolParcels.js --all           # ignore td_status, re-check everything
 */
import pg from "pg";

const BASE = "https://landsmaps.dol.go.th/apiService";
const DAILY_LIMIT = 20;

const WRITE = process.argv.includes("--write");
const ALL = process.argv.includes("--all");
const arg = (k, d = null) => {
    const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
    return hit ? hit.slice(k.length + 3) : d;
};
const LIMIT = Number(arg("limit", 0)) || 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let token = null;
async function authHeaders() {
    if (!token) {
        const r = await fetch(`${BASE}/JWT/GetJWTAccessToken`, { headers: { Accept: "application/json" } });
        const j = await r.json();
        token = j?.result?.[0]?.access_token;
        if (!token) throw new Error(`could not mint token: ${JSON.stringify(j).slice(0, 120)}`);
    }
    return { Authorization: `Bearer ${token}`, Accept: "application/json" };
}

const client = new pg.Client({
    connectionString:
        process.env.DATABASE_URL ?? "postgres://postgres:landmap@localhost:5433/landmap",
});
await client.connect();

/* Reserve quota BEFORE the call, not after. The ledger's CHECK is the backstop,
 * but relying on it means the call is already spent when it trips. */
async function reserveQuota() {
    await client.query(
        `INSERT INTO dol_quota_ledger (quota_date, limit_value)
         VALUES (CURRENT_DATE, $1)
         ON CONFLICT (quota_date) DO UPDATE SET quota_date = EXCLUDED.quota_date`,
        [DAILY_LIMIT],
    );
    const r = await client.query(
        `UPDATE dol_quota_ledger
            SET used = used + 1, first_call_at = COALESCE(first_call_at, now())
          WHERE quota_date = CURRENT_DATE AND used < limit_value
      RETURNING used, limit_value`,
    );
    return r.rows[0] ?? null;
}

async function noteOutcome(ok) {
    await client.query(
        `UPDATE dol_quota_ledger
            SET calls_ok = calls_ok + $1, calls_failed = calls_failed + $2,
                last_call_at = now()
          WHERE quota_date = CURRENT_DATE`,
        [ok ? 1 : 0, ok ? 0 : 1],
    );
}

const where = ["p.deed_number IS NOT NULL", "p.deed_number <> ''", "d.dol_code IS NOT NULL"];
if (!ALL) where.push("p.td_status IS DISTINCT FROM 'resolved'");
const params = [];

/* Specific parcels, for a spot check that spends only a few of the day's
 * twenty. The ids are comma separated: --ids=9363,10585 */
const ids = (process.argv.find((a) => a.startsWith("--ids=")) ?? "").slice(6)
    .split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
if (ids.length) {
    where.push(`p.id = ANY($${params.length + 1}::bigint[])`);
    params.push(ids);
}

const sql = `
  SELECT p.id AS parcel_id, p.deed_number, p.province_name, p.tumbol,
         d.name AS district_name, d.td_province_code, d.dol_code
    FROM parcels p
    JOIN districts d
      ON d.province_id = p.province_code AND d.dol_code = p.district_dol_code
   WHERE ${where.join(" AND ")}
   ORDER BY d.td_province_code, d.dol_code, p.deed_number`;

let todo = (await client.query(sql, params)).rows;
if (LIMIT) todo = todo.slice(0, LIMIT);

const q = (await client.query(
    `SELECT used, limit_value FROM dol_quota_ledger WHERE quota_date = CURRENT_DATE`)).rows[0];
const remaining = q ? Math.max(0, q.limit_value - q.used) : DAILY_LIMIT;

console.log(`  [cfg] ${todo.length} parcels${ALL ? " (all, re-check)" : " (TD did not resolve)"}, quota ${remaining}/${DAILY_LIMIT} left today, ${WRITE ? "WRITE" : "dry run"}`);
if (!todo.length) { console.log("  nothing to do"); await client.end(); process.exit(0); }
if (!remaining) {
    console.log("  daily DOL quota spent - nothing to do until tomorrow");
    await client.end();
    process.exit(0);
}

const stats = { found: 0, noResult: 0, quotaSpent: 0, error: 0, sizeAgree: 0, sizeDiffer: 0, districtWrong: 0 };
const problems = [];

for (const p of todo) {
    if (stats.found + stats.noResult + stats.error >= remaining) {
        stats.quotaSpent++;
        console.log(`  quota reached; stopping. ${todo.length - stats.found - stats.noResult - stats.error} left for tomorrow.`);
        break;
    }

    const res = await reserveQuota();
    if (!res) { stats.quotaSpent++; break; }

    const amph = String(p.dol_code).padStart(2, "0");
    let j = null;
    try {
        const r = await fetch(`${BASE}/LandsMaps/GetParcelByParcelNo/${p.td_province_code}/${amph}/${p.deed_number}`, {
            headers: await authHeaders(),
        });
        j = await r.json();
    } catch (e) {
        stats.error++;
        console.log(`  ${p.deed_number}: ERROR ${e.message.slice(0, 70)}`);
        await noteOutcome(false);
        continue;
    }

    /* The quota message arrives as status 500 with a Thai body. Surface it
     * rather than treating it as "no such parcel". */
    const msg = String(j?.message ?? "");
    if (msg.includes("เกินจำกัด")) {
        stats.quotaSpent++;
        console.log(`  DOL says quota exceeded: ${msg.trim().split("\n")[0]}`);
        await client.query(`UPDATE dol_quota_ledger SET used = limit_value WHERE quota_date = CURRENT_DATE`);
        break;
    }

    await noteOutcome(true);
    const row = Array.isArray(j?.result) ? j.result[0] : null;
    if (!row) {
        stats.noResult++;
        console.log(`  ${p.deed_number}  ${p.district_name}: DOL has no record`);
        continue;
    }

    const want = String(p.district_name ?? "").trim();
    const got = String(row.amphurname ?? "").trim();
    if (want && got && want !== got) {
        stats.districtWrong++;
        problems.push({ deed: p.deed_number, want, got, reason: "district disagrees with our map" });
    }

    /* The size check. DOL reports subwa in ตราสตน์ (hundredths of a wah) but
     * drops the trailing zero, so a parcel LED prints as 58.60 ตร.วา comes back
     * as wa=58, subwa=6. Reading subwa as hundredths directly gives 58.06 and a
     * false mismatch; it is a single digit standing for the tens of hundredths,
     * so 6 means 0.60. Every disagreement observed follows that shape - 58.60 vs
     * 58.06, 16.70 vs 16.07, 183.90 vs 183.09 - and with the scale fixed all
     * three agree exactly.
     *
     * LED's own figure is trusted as the yardstick here, which is the point: it
     * is the only independent check on the scraper we have. */
    const lot = (await client.query(
        `SELECT size_rai, size_ngan, size_wa FROM auction_lots
          WHERE parcel_id = $1 ORDER BY id LIMIT 1`, [p.parcel_id])).rows[0];
    if (lot?.size_wa != null) {
        const ledWah = Number(lot.size_rai) * 400 + Number(lot.size_ngan) * 100 + Number(lot.size_wa);
        const dolWah =
            Number(row.rai) * 400 +
            Number(row.ngan) * 100 +
            Number(row.wa) +
            (Number(row.subwa ?? 0) || 0) / 10;
        if (Math.abs(ledWah - dolWah) < 0.05) stats.sizeAgree++;
        else {
            stats.sizeDiffer++;
            problems.push({ deed: p.deed_number, want: `${ledWah.toFixed(2)} ตร.วา (LED)`, got: `${dolWah.toFixed(2)} ตร.วา (DOL)`, reason: "size disagrees" });
        }
    }

    stats.found++;
    console.log(
        `    ${p.deed_number.padEnd(10)} ${got.padEnd(14)} ${String(row.tumbolname ?? "").padEnd(14)} ` +
        `${row.parcellat}, ${row.parcellon}  ${row.rai}-${row.ngan}-${row.wa}${row.subwa ? "." + String(row.subwa).padEnd(2, "0") : ""} ${row.utm ?? ""}`,
    );

    if (WRITE) {
        /* DOL reports the ตร.วา in two parts: wa and subwa, the subwa being
         * the hundredths. The size check above already adds them, and the
         * stored figure has to be the same number it checked - storing the
         * whole part alone wrote 2 for a parcel of 2.90. */
        const dolWa = row.wa != null
            ? Number(row.wa) + (Number(row.subwa ?? 0) || 0) / 10
            : null;
        await client.query(
            `UPDATE parcels
                SET dol_lat      = $2,
                    dol_lon      = $3,
                    dol_rai      = $4,
                    dol_ngan     = $5,
                    dol_wa       = $6,
                    dol_office   = $7,
                    dol_land_type = $8,
                    dol_status   = 'resolved',
                    dol_checked_at = now()
              WHERE id = $1`,
            [p.parcel_id,
             row.parcellat != null ? Number(row.parcellat) : null,
             row.parcellon != null ? Number(row.parcellon) : null,
             row.rai ?? null, row.ngan ?? null, dolWa,
             row.landoffice ?? null, row.parcel_type ?? null],
        );
    }
    await sleep(250);
}

console.log(`\n  found          ${stats.found}`);
console.log(`  no DOL record  ${stats.noResult}`);
console.log(`  errors         ${stats.error}`);
console.log(`  size agrees with LED  ${stats.sizeAgree}`);
console.log(`  size disagrees         ${stats.sizeDiffer}`);
console.log(`  district disagrees     ${stats.districtWrong}`);
if (problems.length) {
    console.log(`\n  needs a human (${problems.length}):`);
    for (const x of problems.slice(0, 20)) console.log(`    ${x.deed}: ${x.reason} (want ${x.want}, got ${x.got})`);
}
if (!WRITE) console.log("\n  DRY RUN - nothing written. Re-run with --write.");

await client.end();