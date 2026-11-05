import { readFileSync } from "node:fs";
const html = readFileSync(new URL("./probe_case3_ผบE390_2568.html", import.meta.url), "utf8");
const table = html.match(/<table class="table[\s\S]{100,}?<\/table>/i)?.[0] ?? "";
const trs = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(m => m[1]);
const row = trs.find(t => t.includes("63718") && t.includes("1,540,000")) ?? trs[0];
const cells = row.replace(/<\/t[dh]>/gi, " | ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().replace(/^ \| /, "").replace(/ \| $/, "").split(" | ").map(c => c.trim());
console.log("cells", cells.length);
cells.forEach((c, i) => console.log(` ${i}: [${c}]`));
