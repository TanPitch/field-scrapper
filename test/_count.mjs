import fs from "fs";
const src = fs.readFileSync("ingest.js", "utf8");

const m = src.match(/const LOT_COLUMNS = `([\s\S]*?)`;/);
const cols = m[1].split(",").map((s) => s.trim()).filter(Boolean);

const start = src.indexOf("async function upsertLot");
const end = src.indexOf("const setClause", start);
const slice = src.slice(start, end);
const lb = slice.indexOf("    const values = [");
const rb = slice.indexOf("];", lb);
const body = slice.slice(lb, rb);

// Count values at bracket depth 1, ignoring commas inside strings/brackets.
let depth = 0, count = 1, quote = null;
for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) {
        if (ch === "\\") { i++; continue; }
        if (ch === quote) quote = null;
        continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") { quote = ch; continue; }
    if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth--;
    else if (ch === "," && depth === 1) count++;
}
console.log("  LOT_COLUMNS entries : " + cols.length);
console.log("  values entries      : " + count);
console.log("  ALIGNED             : " + (cols.length === count));
if (cols.length !== count) {
    console.log("\n  tail of columns: " + cols.slice(-6).join(", "));
    console.log("  -> a mismatch means values are shifted into the wrong columns,");
    console.log("     which would put dates/prices into the key columns.");
}