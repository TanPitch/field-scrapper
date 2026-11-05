import { readFileSync } from "node:fs";
import { parseRows, beIso } from "./extract_rows.mjs";
const rows = parseRows(readFileSync(new URL("./probe_case3_ผบ2737.html", import.meta.url), "utf8"));
const hit = rows.filter((r) => r[3]?.replace(/\s/g, "").includes("34387"));
console.log("34387 rows:", hit.length);
for (const r of hit.slice(0, 8)) console.log(`  ${beIso(r[0])} | ${r[1]} | deed=${r[3]} | ${r[5]} | ประเมิน=${r[6]} | ${r[7]} | ขายได้=${r[8]}`);
const de = {};
for (const r of rows) (de[r[3]] ??= new Set()).add(r[1]);
console.log("distinct deed strings:", Object.keys(de).length);
