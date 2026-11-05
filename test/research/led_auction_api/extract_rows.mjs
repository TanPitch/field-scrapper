// extract_rows.mjs — prototype parser for /report_new/reports.asp results.
// Turns the saved probe_case3_*.html into structured rows so the data shape
// for server/ledReport.js is pinned down before it is written.
import { readFileSync } from "node:fs";

const strip = (h) =>
  h.replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

/** One results table per page; rows keep their 9 cells as plain text. */
export function parseRows(html) {
  const table = html.match(/<table class="table[\s\S]{100,}?<\/table>/i)?.[0];
  if (!table) return [];
  return [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((m) => m[1]
      .replace(/<\/t[dh]>/gi, " | ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
      .replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim())
    .map((t) => t.replace(/^ \| /, "").replace(/ \| $/, "").split(" | ").map((c) => c.trim()))
    .filter((c) => c.length >= 9 && /^\d\d-\d\d-\d\d\d\d$/.test(c[0]));
}

/** BE date คอลัมน์ วันที่: dd-mm-2569 -> ISO 2026-09-30. */
export const beIso = (d) => {
  const [dd, mm, by] = d.split("-");
  const y = Number(by) - 543;
  return `${String(y).padStart(4, "0")}-${mm}-${dd}`;
};

/* dump every row for the three saved probes */
for (const [file, want] of [
  ["probe_case3_ผบE390_2568.html", "63718"],
  ["probe_case3_ผบE2311_2566.html", "168661"],
  ["probe_case3_ผบ2545_2562.html", null],
]) {
  const rows = parseRows(readFileSync(new URL(`./${file}`, import.meta.url), "utf8"));
  console.log(`== ${file}: ${rows.length} rows`);
  const shown = want ? rows.filter((r) => r[3]?.includes(want)) : rows;
  for (const r of shown.slice(0, 12)) {
    console.log(`  ${beIso(r[0])} | court=${r[1]} | case=${r[2]} | deed=${r[3]} | จ=${r[5]} | ประเมิน=${r[6]} | ผล=${r[7]} | ขายได้=${r[8]}`);
  }
  if (shown.length > 12) console.log(`  … +${shown.length - 12} more`);
}
