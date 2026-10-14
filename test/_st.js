const { SQL } = await import("bun");
const db = new SQL(process.env.DATABASE_URL);
for (const [l, s] of [
  ["lots", "SELECT count(*) n FROM auction_lots"],
  ["rounds", "SELECT count(*) n FROM auction_rounds"],
  ["parcels", "SELECT count(*) n FROM parcels"],
  ["parcels with geometry", "SELECT count(*) n FROM parcels WHERE geom IS NOT NULL"],
]) { const r = await db.unsafe(s); console.log("  " + l.padEnd(24) + r[0].n); }
const p = await db.unsafe("SELECT province_code, province_name, count(*) n, count(geom) g FROM parcels GROUP BY 1,2 ORDER BY n DESC");
for (const x of p) console.log(`    province ${x.province_code} ${x.province_name ?? "-"}: ${x.n} parcels, ${x.g} with geometry`);
const c = await db.unsafe("SELECT status_code, count(*) n FROM auction_rounds GROUP BY 1 ORDER BY 1");
console.log("  round status codes: " + c.map((x) => `${x.status_code}=${x.n}`).join("  "));
const a = await db.unsafe("SELECT asset_type, count(*) n FROM auction_lots GROUP BY 1 ORDER BY n DESC");
for (const x of a) console.log(`    ${x.asset_type}: ${x.n}`);
// พ.376/2568 sale state, to check against LED
const u = await db.unsafe(`SELECT order_label, plot_no, status, start_price FROM auction_lots
   WHERE case_no = 'พ.376' AND case_year = '2568' ORDER BY order_label`);
console.log("\n  พ.376/2568 condo units:");
for (const x of u) console.log(`    ${String(x.order_label).padEnd(8)}${String(x.plot_no).padEnd(9)}${String(x.status).padEnd(10)}${Number(x.start_price).toLocaleString()}`);
await db.close();