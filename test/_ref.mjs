import fs from "fs";
import { priceRow } from "./pricing.js";

const raw = JSON.parse(fs.readFileSync("out/rows.json", "utf8"));
const lots = raw.map((r) => priceRow(r));
const num = (v) => (v == null || v === "" ? -1 : Number(v));

const lotKey = (p) => [
    p.address?.province_id ?? "", p.address?.city ?? "", p.case_no ?? "", p.case_year ?? "",
    num(p.order?.number), num(p.order?.sub), (p.bid?.rounds?.[0]?.date ?? "").slice(0, 10),
].join("|");

const groups = new Map();
for (const [i, p] of lots.entries()) {
    const k = lotKey(p);
    (groups.get(k) ?? groups.set(k, []).get(k)).push({ i, p });
}

const flat = (o) => (o && typeof o === "object"
    ? Object.entries(o).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`).join(" ")
    : String(o ?? "-"));

const wa = (s) => (s ? `${s.rai ?? 0}-${s.ngan ?? 0}-${s.wa ?? 0} วา` : "-");

let g = 0;
for (const [k, group] of groups) {
    if (group.length < 2) continue;
    g++;
    const f = k.split("|");
    console.log("");
    console.log(`############ GROUP ${g}  (${group.length} rows) ############`);
    console.log(`  case_year      : ${f[3] || "-"}`);
    console.log(`  case_no raw    : ${flat(group[0].p.case_no)}`);
    console.log(`  court          : ${group[0].p.court ?? "-"}`);
    console.log(`  order          : ${flat(group[0].p.order)}`);
    console.log(`  province/city  : ${f[0]} / ${f[1]}`);
    console.log(`  tumbol         : ${group[0].p.address?.tumbol ?? "-"}   amphur: ${group[0].p.address?.amphur ?? "-"}   city: ${group[0].p.address?.city ?? "-"}`);
    console.log(`  published      : ${group[0].p.published_date ?? "-"}`);
    console.log(`  first round    : ${f[6]}`);
    console.log(`  owner          : ${group[0].p.owner ?? "-"}`);
    console.log("");
    console.log("  idx | plot/plot-no | deed | area          | start price   | price/wah | lot type");
    for (const { i, p } of group) {
        const a = p.address ?? {};
        const rnd = (p.bid?.rounds ?? [])[0] ?? {};
        const per = rnd.price && p.size ? Math.round(rnd.price / (Number(p.size.wa) || 1)) : 0;
        console.log(
            `  ${String(i).padStart(3)} | ${String(a.addr_no ?? "-").padEnd(13)} | ${String(a.number ?? "-").padEnd(7)} | ` +
            `${wa(p.size).padEnd(13)} | ${String(rnd.price ?? "-").padStart(11)} | ${String(per).padStart(9)} | ${p.type ?? "-"}`,
        );
    }
}
console.log("");
console.log(`  ${g} collision group(s).`);