import fs from "fs";
import { priceRow } from "./pricing.js";
const rows = JSON.parse(fs.readFileSync("out/rows.json", "utf8")).map((r) => priceRow(r));
const seen = new Map();
for (const r of rows) for (const x of r.bid?.rounds ?? []) {
  const c = x.statusCode;
  if (c == null) continue;
  if (!seen.has(c)) seen.set(c, { n: 0, label: x.status_label ?? "", sample: x.label ?? "" });
  seen.get(c).n++;
}
const ALLOWED = new Set([0, 1, 3, 6, 7, 10, 13, 23, 26]);
console.log("  code  count  allowed?  label");
for (const [c, v] of [...seen.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`  ${String(c).padStart(4)} ${String(v.n).padStart(6)}  ${ALLOWED.has(c) ? "yes" : "NO "}       ${v.sample.slice(0, 60)}`);
}