import fs from "fs";

const BATCH = "13/2569 - 1";
const ev = fs.readFileSync("./out/issale-evidence.md", "utf8");
const lots = new Map();
for (const m of ev.matchAll(/- \*\*(.+?) \(deed (.+?)\)\*\*  codes \[(.+?)\]/g))
  lots.set(m[1].trim() + "|" + m[2], { order: m[1].trim(), deed: m[2], codes: m[3] });

const full = {
  "1 - 1|2435": { caseNo: "ผบE.2817/2568", type: "ห้องชุด", tumbol: "-", amphur: "บางกอกน้อย", city: "กรุงเทพมหานคร", court: "แพ่ง", codes: "3,3,1,1,1,1,0,0" },
  "4 - 1|1403": { caseNo: "พ.4037/2568", type: "ที่ดินพร้อมสิ่งปลูกสร้าง", tumbol: "-", amphur: "พญาไท(ดุสิต)", city: "กรุงเทพมหานคร", court: "แพ่ง", codes: "0,13,26,26,26,26,0,0" },
  "7 - 1|27348": { caseNo: "ผบE.7667/2567", type: "ห้องชุด", tumbol: "-", amphur: "บึงกุ่ม", city: "กรุงเทพมหานคร", court: "แขวงพระนครเหนือ", codes: "6,6,6,6,6,6,0,0" },
  "12 - 1|2094": { caseNo: "ผบ.3527/2562", type: "ห้องชุด", tumbol: "-", amphur: "บางซื่อ", city: "จังหวัดนนทบุรี", court: "-", codes: "23,0,26,26,26,26,0,0" },
  "13 - 1|5880": { caseNo: "ผบE.1819/2568", type: "ห้องชุด", tumbol: "-", amphur: "ห้วยขวาง", city: "จังหวัดชุมพร", court: "-", codes: "7,10,10,10,10,10,0,0" },
};
const caseByOrder = { "4 - 1": "พ.4037/2568", "7 - 1": "ผบE.7667/2567", "12 - 1": "ผบ.3527/2562", "13 - 1": "ผบE.1819/2568", "14 - 1": "ผบ.659/2566", "23 - 1": "ผบ.9449/2552", "25 - 1": "พ.2090/2567" };
const MAPPED = new Set(["0", "1", "3"]);
const num = (s) => { const m = /(\d+)/.exec(s); return m ? Number(m[1]) : 0; };

const rows = [...lots.values()].map((l) => {
  const f = full[l.order + "|" + l.deed] || {};
  const codes = (f.codes || l.codes).split(",").map((s) => s.trim());
  const uniq = [...new Set(codes.filter((c) => c && c !== "-"))];
  return {
    order: l.order, deed: l.deed,
    caseNo: f.caseNo || caseByOrder[l.order] || "-",
    type: f.type || "-", tumbol: f.tumbol || "-", amphur: f.amphur || "-", city: f.city || "-",
    codes, unknown: uniq.some((c) => !MAPPED.has(c)),
  };
});
rows.push({ order: "1 - 1", deed: "2435", ...full["1 - 1|2435"], codes: full["1 - 1|2435"].codes.split(",").map((s) => s.trim()) });
rows.sort((a, b) => num(a.order) - num(b.order));

let md = `# issale lookup — lots to check on LED\n\n`;
md += `Every lot below is from batch **${BATCH}** (ล็อตที่-ชุดที่).\n\n`;
md += `On LED: open the batch, find the lot by **ลำดับที่การขาย**, open its detail page, and read the timeline labels against the codes.\n\n`;
md += `| # | ลำดับที่การขาย | โฉนด | หมายเลขคดี | ประเภททรัพย์ | ตำบล | อำเภอ | จังหวัด | issale codes (r1..r8) |\n`;
md += `|---|---|---|---|---|---|---|---|---|\n`;
rows.forEach((r, i) => {
  md += `| ${i + 1} | ${r.order} | ${r.deed} | ${r.caseNo} | ${r.type} | ${r.tumbol} | ${r.amphur} | ${r.city} | ${r.codes.join(", ")}${r.unknown ? " ⚠" : ""} |\n`;
});
md += `\n⚠ = has an unmapped code. "-" = not recovered (see note).\n\n`;
md += `## Already mapped\n\n| code | label |\n|---|---|\n| 0 | ลงทะเบียนเข้าสู้ราคา |\n| 1 | ขายได้ |\n| 3 | งดขายไม่มีผู้สู้ราคา |\n\n`;
md += `## Unmapped\n\n**6, 7, 10, 13, 23, 26**\n\n`;
md += `## Note on coverage\n\n`;
md += `The 30-row results dump was lost: the LED site stopped returning rows, and re-running the scraper overwrote \`out/page-1.html\` with the empty response. `;
md += `This table is rebuilt from artifacts written before that happened, so ${rows.length} of the 30 lots are listed and the location columns are incomplete for most. `;
md += `When the site serves data again, re-run \`LED_PROVINCE='*' LED_MAX_PAGES=1 node discoverLED.js\` to regenerate the full set.\n`;

fs.writeFileSync("./out/issale-lookup.md", md, "utf8");
console.log("lots:", rows.length, "| unknown:", rows.filter((r) => r.unknown).length, "| full fields:", rows.filter((r) => r.type !== "-").length);
