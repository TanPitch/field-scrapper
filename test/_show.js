const { SQL } = await import("bun");
import { priceRow } from "./pricing.js";
import fs from "fs";
const db = new SQL(process.env.DATABASE_URL);

console.log("========== 1. PHUKET, as the frontend now receives it ==========\n");
const rows = await db.unsafe(`
  SELECT p.id AS parcel_id, p.deed_number, p.td_status, p.td_eva_price, p.geo_precision,
         l.id AS lot_id, l.order_label, l.plot_no, l.asset_type,
         l.size_unit, l.size_rai, l.size_ngan, l.size_wa, l.start_price, l.status
    FROM parcels p JOIN auction_lots l ON l.parcel_id = p.id
   ORDER BY l.id`);
console.log(`  lots joined: ${rows.length}`);
const condo = rows.filter(r => r.asset_type === "ห้องชุด");
console.log(`  condo units: ${condo.length}  -> building deed ${condo[0]?.deed_number}`);
console.log("  order  plot     area            start price   td assessment  td status");
for (const r of condo) {
  const area = `${r.size_rai}-${r.size_ngan}-${r.size_wa} ${r.size_unit}`;
  console.log(`    ${String(r.order_label).padEnd(7)}${String(r.plot_no).padEnd(8)}${area.padEnd(16)}${Number(r.start_price).toLocaleString().padStart(12)}${String(r.td_eva_price ?? "-").padStart(14)}${String(r.td_status ?? "-").padEnd(12)}`);
}
const bare = rows.filter(r => r.asset_type !== "ห้องชุด");
console.log(`\n  bare-land lots: ${bare.length}`);
console.log("  first 3:");
for (const r of bare.slice(0, 3)) {
  console.log(`    ${String(r.order_label).padEnd(7)}deed ${String(r.deed_number).padEnd(8)} ${r.size_rai}-${r.size_ngan}-${r.size_wa} ${r.size_unit}  ${Number(r.start_price).toLocaleString().padStart(12)}  ${r.status}`);
}

console.log("\n========== 2. the priceLadder guard ==========\n");
const codes = await db.unsafe(`SELECT status_code, count(*) n FROM auction_rounds GROUP BY 1 ORDER BY 1`);
console.log("  status_code across all rounds:");
for (const c of codes) console.log(`    code ${c.status_code}: ${c.n}`);
console.log(`    (the test needs code 3 = no-bid rounds to deepen the discount; there are ${codes.find(c => c.status_code === 3)?.n ?? 0})`);
console.log(`    status_code 1 = sold: ${codes.find(c => c.status_code === 1)?.n ?? 0}`);
console.log(`    status_code 26 = lapsed: ${codes.find(c => c.status_code === 26)?.n ?? 0}`);
console.log(`    status_code 0 = not yet held: ${codes.find(c => c.status_code === 0)?.n ?? 0}`);

const sample = await db.unsafe(`
  SELECT l.id, l.case_no, l.order_label, l.deed_number, l.plot_no, l.status,
         (SELECT count(*)::int FROM auction_rounds r WHERE r.lot_id=l.id) rounds,
         (SELECT count(*)::int FROM auction_rounds r WHERE r.lot_id=l.id AND r.status_code=3) no_bid,
         (SELECT count(*)::int FROM auction_rounds r WHERE r.lot_id=l.id AND r.status_code=1) sold
    FROM auction_lots l WHERE l.asset_type='ห้องชุด' ORDER BY l.id`);
console.log("\n  the condo units, round by round:");
console.log("    lot  order  plot     deed    rounds  no_bid(3)  sold(1)  status");
for (const r of sample) {
  console.log(`    ${String(r.id).padEnd(5)}${String(r.order_label).padEnd(7)}${String(r.plot_no).padEnd(8)}${String(r.deed_number).padEnd(8)}${String(r.rounds).padStart(5)}${String(r.no_bid).padStart(10)}${String(r.sold).padStart(9)}  ${r.status}`);
}
await db.close();