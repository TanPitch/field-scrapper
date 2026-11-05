import { readFileSync } from "node:fs";
import { parseResult } from "../../../server/ledReport.js";
const { rows } = parseResult(readFileSync(new URL("./probe_case3_ผบE390_2568.html", import.meta.url), "utf8"));
console.log("rows", rows.length);
for (const r of rows.slice(0, 3)) console.log(JSON.stringify(r));
