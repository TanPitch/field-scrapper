import { readFileSync } from "node:fs";
import { parseResult } from "../../../server/ledReport.js";
const { rows } = parseResult(readFileSync(new URL("./probe_case3_ผบE390_2568.html", import.meta.url), "utf8"));
for (const r of rows.filter(r => r.deed.includes("63718"))) console.log(JSON.stringify(r));
