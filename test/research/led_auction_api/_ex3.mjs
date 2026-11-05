import { readFileSync } from "node:fs";
import { parseRows } from "./extract_rows.mjs";
const rows = parseRows(readFileSync(new URL("./probe_case3_ผบ2545_2562.html", import.meta.url), "utf8"));
for (const d of ["2345", "2346", "628"]) {
  const hit = rows.filter((r) => r[3] === d);
  const courts = [...new Set(hit.map((r) => r[1]))];
  const outc = [...new Set(hit.map((r) => r[7]))];
  const pric = [...new Set(hit.map((r) => r[6]))];
  console.log(`deed ${d}: ${hit.length} rows, courts=${courts.join(",")}, outcomes=${outc.join(" / ")}, prices=${pric.join(",")}`);
}
const other = rows.filter((r) => !["2345", "2346", "628", "120160"].includes(r[3]));
console.log("sample other-courts rows:");
for (const r of other.slice(0, 6)) console.log(`  ${r[1]} | deed=${r[3]} | ${r[5]} | ${r[6]} | ${r[7]} | ${r[8]}`);
