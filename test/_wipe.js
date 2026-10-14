const { SQL } = await import("bun");
const db = new SQL(process.env.DATABASE_URL);

const a = await db.unsafe(`SELECT order_number, order_sub, order_label FROM auction_lots
  WHERE case_no='4302' AND case_year='2549' LIMIT 5`);
console.log("  ลำดับการขาย stored as:");
for (const x of a) console.log(`    order_number=${x.order_number} order_sub=${x.order_sub} label=${x.order_label}`);

// Full wipe of scraped data. Schema, migrations, users and settings stay.
console.log("\n  wiping scraped data...");
for (const t of ["auction_rounds", "auction_lots", "lot_images", "field_provenance", "parcels"]) {
  try { const r = await db.unsafe(`DELETE FROM ${t}`); console.log(`    ${t}: ${r.count}`); }
  catch (e) { console.log(`    ${t}: skipped (${String(e.message).slice(0, 50)})`); }
}
await db.unsafe(`UPDATE coord_queue SET status='pending' WHERE status <> 'pending'`).catch(() => {});

const counts = {};
for (const t of ["auction_lots", "auction_rounds", "parcels", "lot_images", "app_users"]) {
  const r = await db.unsafe(`SELECT count(*) n FROM ${t}`);
  counts[t] = r[0].n;
}
console.log("\n  after wipe: " + JSON.stringify(counts));
await db.close();