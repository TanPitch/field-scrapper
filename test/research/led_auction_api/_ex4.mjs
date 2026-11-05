import { readFileSync } from "node:fs";
import { parseRows, beIso } from "./extract_rows.mjs";
const rows = parseRows(readFileSync(new URL("./probe_case3_ผบ2737.html", import.meta.url), "utf8"));
console.log("rows", rows.length);
for (const r of rows.slice(0, 8)) console.log(`  ${beIso(r[0])} | ${r[1]} | deed=${r[3]} | ${r[5]} | ประเมิน=${r[6]} | ${r[7]} | ขายได้=${r[8]}`);
