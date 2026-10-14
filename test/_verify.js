const { SQL } = await import("bun");
const db = new SQL(process.env.DATABASE_URL);
const q = async (l, s) => { const r = await db.unsafe(s); console.log("  " + l.padEnd(24) + (r[0]?.n ?? "?")); };
await q("lots", "SELECT count(*) n FROM auction_lots");
await q("rounds", "SELECT count(*) n FROM auction_rounds");
await q("parcels", "SELECT count(*) n FROM parcels");
await q("provenance", "SELECT count(*) n FROM field_provenance");
await q("dup natural keys", `SELECT count(*) n FROM (
    SELECT 1 FROM auction_lots
     GROUP BY case_no, case_year, coalesce(order_number,-1), coalesce(order_sub,-1),
              coalesce(deed_number,''), coalesce(plot_no,''), first_round_date
    HAVING count(*) > 1) x`);
await q("group-sale lots", "SELECT count(*) n FROM auction_lots WHERE group_lot_count IS NOT NULL");

const g = await db.unsafe(`SELECT order_label, group_lot_count, group_total_price, count(*) n
    FROM auction_lots WHERE group_lot_count IS NOT NULL GROUP BY 1,2,3 ORDER BY 1`);
console.log("  order    declared  ingested   group total");
for (const r of g) {
    console.log(`    ${String(r.order_label).padEnd(8)} ${String(r.group_lot_count).padStart(6)}  ${String(r.n).padStart(8)}   ${Number(r.group_total_price).toLocaleString()}`);
}
await db.close();