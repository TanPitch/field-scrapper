/* verification.js — always generate the hand-check table from the database.
 *
 * This exists because I once retyped a case number as ผบE.9495 when LED had sent
 * ผบ.9495, and the user caught it. Nothing here is hand-typed: every value is
 * read from Postgres, so the table cannot disagree with the data.
 *
 *   DATABASE_URL=... bun verification.js
 */
import pg from "pg";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const pad = (s, n) => String(s ?? "").padEnd(n);
const num = (v) => (v === null || v === undefined ? "—" : Number(v).toLocaleString("en-US"));
const coord = (a, b) => (a === null ? "—" : `${Number(a).toFixed(5)}, ${Number(b).toFixed(5)}`);

const { rows } = await client.query(`
    SELECT l.case_no, l.case_year, l.order_label, l.legal_exec_dept,
           p.deed_number, p.land_title, p.tumbol, p.district_name, p.province_name,
           p.td_lat, p.td_lon, p.td_eva_price, p.td_rawang, p.td_status,
           p.geo_precision,
           l.size_rai, l.size_ngan, l.size_wa
      FROM parcels p
      JOIN LATERAL (SELECT case_no, case_year, order_label, legal_exec_dept,
                           size_rai, size_ngan, size_wa
                      FROM auction_lots WHERE parcel_id = p.id
                     ORDER BY id LIMIT 1) l ON true
     ORDER BY p.td_eva_price DESC NULLS LAST`);

const enriched = rows.filter((r) => r.td_eva_price !== null);
const pending = rows.filter((r) => r.td_eva_price === null);

console.log("LED -> TD   (กรมธนารักย์ only — กรมที่ดิน excluded by request)");
console.log("=".repeat(126));
console.log(
    pad("หมายเลขคดี", 11) + pad("ปี", 6) + pad("ลำดับ", 8) +
    pad("โฉนด", 9) + pad("ตำบล", 13) + pad("lat, lon", 20) +
    pad("฿/ตร.วา", 11) + pad("ระวาง", 17) + "ขนาด",
);
console.log("-".repeat(126));
for (const r of enriched) {
    console.log(
        pad(r.case_no, 11) + pad(r.case_year, 6) + pad(r.order_label, 8) +
        pad(r.deed_number, 9) + pad(r.tumbol, 13) +
        pad(coord(r.td_lat, r.td_lon), 20) + pad(num(r.td_eva_price), 11) +
        pad(r.td_rawang, 17) +
        `${Number(r.size_rai) || 0}-${Number(r.size_ngan) || 0}-${Number(r.size_wa) || 0}`,
    );
}

console.log(`\nenriched ${enriched.length} / ${rows.length}`);

console.log(`\n${"=".repeat(126)}`);
console.log("PENDING — routed to a layer we do not have yet, deliberately not faked");
console.log("-".repeat(126));
console.log(pad("หมายเลขคดี", 11) + pad("โฉนด", 9) + pad("ชนิดสิทธิ์", 11) +
    pad("ตำบล", 13) + pad("อำเภอ", 15) + "status");
for (const r of pending) {
    console.log(pad(r.case_no, 11) + pad(r.deed_number, 9) + pad(r.land_title, 11) +
        pad(r.tumbol, 13) + pad(r.district_name, 15) + (r.td_status ?? "(no status)"));
}

const byReason = {};
for (const r of pending) byReason[r.td_status ?? "unknown"] = (byReason[r.td_status ?? "unknown"] ?? 0) + 1;
console.log(`\n${JSON.stringify(byReason)}`);

await client.end();
