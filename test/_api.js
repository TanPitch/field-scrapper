const { SQL } = await import("bun");
const db = new SQL(process.env.DATABASE_URL);
// Mirror of the API's parcel -> lot join (LEFT JOIN LATERAL ... LIMIT 1).
const r = await db.unsafe(`
  SELECT p.id, p.deed_number,
         (SELECT count(*) FROM auction_lots WHERE parcel_id = p.id)::int AS lots_behind
    FROM parcels p ORDER BY p.id LIMIT 1000`);
const hidden = r.filter(x => x.lots_behind > 1);
console.log(`  parcels returned by the API query: ${r.length}`);
console.log(`  parcels whose extra lots are dropped by LIMIT 1: ${hidden.length}`);
for (const x of hidden) {
    console.log(`    parcel ${x.id}  deed=${x.deed_number}  lots behind it: ${x.lots_behind}`);
}
const lost = hidden.reduce((a, x) => a + (x.lots_behind - 1), 0);
console.log(`  lots that never reach the frontend: ${lost}`);
await db.close();