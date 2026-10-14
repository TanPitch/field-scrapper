const { SQL } = await import("bun");
const db = new SQL(process.env.DATABASE_URL);
const WANT = new Set([4, 12]);
console.log("=== rounds whose status_code is outside the known set ===\n");
const r = await db.unsafe(`
  SELECT l.id, l.case_no, l.case_year, l.court, l.owner, l.plaintiff, l.defendant,
         l.order_label, l.order_number, l.order_sub, l.deed_number, l.plot_no,
         l.asset_type, p.tumbol, p.district_name, p.province_name, l.published_date,
         l.size_rai, l.size_ngan, l.size_wa, l.size_unit, l.start_price,
         l.bid_security, l.committee_price, l.led_price, l.officer_price, l.expert_price,
         rr.idx, rr.status_code, rr.round_date::text, rr.price, rr.status_label
    FROM auction_rounds rr JOIN auction_lots l ON l.id = rr.lot_id
    LEFT JOIN parcels p ON p.id = l.parcel_id
   WHERE rr.status_code NOT IN (0,1,3,6,7,10,13,23,26)
   ORDER BY rr.status_code, l.id`);
for (const x of r) {
  console.log(`  ---------------- status_code ${x.status_code} (LED label: "${x.status_label}") ----------------`);
  console.log(`    case      : ${x.case_no}/${x.case_year}   order ${x.order_label}   court ${x.court}`);
  console.log(`    owner     : ${x.owner ?? "-"}`);
  console.log(`    plaintiff : ${x.plaintiff ?? "-"}`);
  console.log(`    defendant : ${x.defendant ?? "-"}`);
  console.log(`    land      : ${x.asset_type}   โฉนด ${x.deed_number ?? "-"}   plot ${x.plot_no ?? "-"}`);
  console.log(`    size      : ${x.size_rai}-${x.size_ngan}-${x.size_wa} ${x.size_unit}`);
  console.log(`    area      : ${x.tumbol ?? "-"}, ${x.amphur ?? "-"}, ${x.province_name ?? "-"}`);
  console.log(`    published : ${x.published_date ?? "-"}`);
  console.log(`    lot prices: start ${Number(x.start_price).toLocaleString()}  bid_sec ${Number(x.bid_security || 0).toLocaleString()}`);
  console.log(`                committee ${Number(x.committee_price || 0).toLocaleString()}  led ${Number(x.led_price || 0).toLocaleString()}  officer ${Number(x.officer_price || 0).toLocaleString()}  expert ${Number(x.expert_price || 0).toLocaleString()}`);
  console.log(`    this round: idx ${x.idx}  ${x.round_date ?? "-"}  price ${Number(x.price || 0).toLocaleString()}`);
  console.log(`    search on LED: province ${x.province_name ?? "-"}, case ${x.case_no}/${x.case_year}, order ${x.order_label}`);
  console.log("");
}
console.log(`  total rounds with an unknown code: ${r.length}`);
await db.close();