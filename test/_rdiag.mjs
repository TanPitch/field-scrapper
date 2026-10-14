import fs from "fs";
import { priceRow } from "./pricing.js";

const lots = JSON.parse(fs.readFileSync("out/rows.json", "utf8")).map((r) => priceRow(r));
const num = (v) => (v == null || v === "" ? -1 : Number(v));

/* The exact key lots_natural_key uses. */
const key = (p) => [
    p.case_no, p.case_year,
    num(p.order?.number), num(p.order?.sub),
    p.address?.number ?? p.address?.deeds?.numbers?.[0] ?? "",
    p.address?.addr_no ?? "",
    (p.bid?.rounds?.[0]?.date ?? "").slice(0, 10),
].join("");

const groups = new Map();
for (const [i, p] of lots.entries()) {
    (groups.get(key(p)) ?? groups.set(key(p), []).get(key(p))).push({ i, p });
}
const bad = [...groups.entries()].filter(([, v]) => v.length > 1);
console.log(`  ${lots.length} rows -> ${groups.size} keys -> ${bad.length} colliding\n`);

for (const [k, g] of bad) {
    console.log(`  === key: ${k.split("").join(" | ")}  (${g.length} rows) ===`);
    g.forEach(({ i, p }) => {
        const rs = p.bid?.rounds ?? [];
        const idxs = rs.map((_, k2) => k2).join(",");
        console.log(`    row ${i}: deed=${p.address?.number} plot=${p.address?.addr_no} owner="${p.owner}" court=${p.court}`);
        console.log(`            rounds=${rs.length} idx=[${idxs}]`);
        console.log(`            round0: date=${(rs[0]?.date ?? "-").slice(0, 10)} code=${rs[0]?.statusCode} price=${rs[0]?.price}`);
    });
    console.log("");
}
if (!bad.length) console.log("  no lot-key collisions. The rounds failure has a different cause.");