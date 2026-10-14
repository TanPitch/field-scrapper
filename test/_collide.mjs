import fs from "fs";
import { priceRow } from "./pricing.js";

const raw = JSON.parse(fs.readFileSync("out/rows.json", "utf8"));
const lots = raw.map((r) => priceRow(r));

const num = (v) => (v == null || v === "" ? -1 : Number(v));

// Exactly the columns in auction_lots' natural-key index.
const lotKey = (p) => [
    p.address?.province_id ?? "",
    p.address?.city ?? "",
    p.case_no ?? "",
    p.case_year ?? "",
    num(p.order?.number),
    num(p.order?.sub),
    (p.bid?.rounds?.[0]?.date ?? "").slice(0, 10),
].join(" | ");

const groups = new Map();
for (const [i, p] of lots.entries()) {
    const k = lotKey(p);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push({ i, p });
}

const collisions = [...groups.entries()].filter(([, v]) => v.length > 1);
console.log(`  ${raw.length} rows -> ${groups.size} distinct lot keys -> ${collisions.length} key(s) with >1 row`);
console.log("");

for (const [k, group] of collisions) {
    console.log("  ===== LOT KEY =====");
    console.log("  " + k.split(" | ").map((s, i) => `f${i}=${s}`).join("  "));
    for (const { i, p } of group) {
        const a = p.address ?? {};
        console.log("");
        console.log(`  ---- LED row index ${i} ----`);
        console.log(`    case        : ${p.case_no ?? "-"} / ${p.case_year ?? "-"}`);
        console.log(`    court       : ${p.court ?? "-"}`);
        console.log(`    order       : ${p.order?.label ?? "-"}   (number=${p.order?.number ?? "-"}, sub=${p.order?.sub ?? "-"})`);
        console.log(`    land_title  : ${a.land_title ?? "-"}   (raw=${a.land_title_raw ?? "-"})`);
        console.log(`    deed number : ${a.number ?? "-"}`);
        console.log(`    deeds       : ${JSON.stringify(a.deeds ?? null)}`);
        console.log(`    plot/addr   : ${a.addr_no ?? "-"}   landdesc=${a.landdesc ?? "-"}`);
        console.log(`    owner       : ${p.owner ?? "-"}`);
        console.log(`    size        : ${JSON.stringify(p.size ?? null)}`);
        console.log(`    published   : ${p.published_date ?? "-"}`);
        console.log(`    rounds      : ${(p.bid?.rounds ?? []).length}`);
        (p.bid?.rounds ?? []).forEach((r, k2) => {
            console.log(`       idx=${k2}  date=${(r.date ?? "-").slice(0, 10)}  code=${r.statusCode ?? "-"}  price=${r.price ?? "-"}  status=${(r.status ?? "").slice(0, 26)}`);
        });
    }
    console.log("");
}