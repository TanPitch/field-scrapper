const { SQL } = await import("bun");
const db = new SQL(process.env.DATABASE_URL);
const r = await db.unsafe(`
  SELECT case_no, case_year, order_number, order_sub, deed_number, plot_no, first_round_date,
         count(*) n
    FROM auction_lots
   GROUP BY 1,2,3,4,5,6,7
  HAVING count(*) > 1
   LIMIT 5`);
console.log("  duplicate natural keys remaining: " + r.length);
for (const x of r) console.log("    " + JSON.stringify(x));
const t = await db.unsafe(`SELECT count(*) n FROM auction_lots`);
console.log("  total lots: " + t[0].n);
await db.close();