const { SQL } = await import("bun");
const db = new SQL(process.env.DATABASE_URL);
/* ingest skips a round when status_code is null AND it has no date, so idx can
   develop gaps. If anything downstream treats idx as an array position, the two
   have drifted apart. */
const gaps = await db.unsafe(`
  SELECT lot_id, count(*) AS n, max(idx) AS max_idx,
         count(*) FILTER (WHERE idx <> rn - 1) AS misaligned
    FROM (
      SELECT lot_id, idx, row_number() OVER (PARTITION BY lot_id ORDER BY idx) AS rn
        FROM auction_rounds) t
   GROUP BY lot_id
  HAVING count(*) FILTER (WHERE idx <> rn - 1) > 0
  ORDER BY lot_id LIMIT 10`);
console.log(`  lots where idx != array position: ${gaps.length}`);
for (const g of gaps) console.log(`    lot ${g.lot_id}: rows=${g.n} max_idx=${g.max_idx} misaligned=${g.misaligned}`);

const sample = await db.unsafe(`SELECT idx, status_code, round_date::text d FROM auction_rounds
    WHERE lot_id = ${gaps.length ? gaps[0].lot_id : 0} ORDER BY idx`);
if (sample.length) {
  console.log(`  sample lot ${gaps[0].lot_id} rounds:`);
  for (const r of sample) console.log(`    idx=${String(r.idx).padStart(2)}  code=${r.status_code}  date=${r.d ?? "-"}`);
}
await db.close();