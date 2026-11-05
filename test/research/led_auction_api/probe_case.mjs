// probe_case.mjs — the per-case sold search: /report_new/reports.asp
//
//   ALAW_SUIT_NO + ALAW_SUIT_YEAR  (red case number, BE year — required pair)
//   person1 / startdate            (alternate pair, unused here)
//   Action                         " ค้นหา "
//
// Cross-check from our DB: ผบE.2225/2567 sold on 30/09/2026 (round price 865872).
// Run:  bun probe_case.mjs
//
import { writeFileSync } from "node:fs";

const URL_ = "https://asset.led.go.th/report_new/reports.asp";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function decode(res) {
  const buf = Buffer.from(await res.arrayBuffer());
  const head = buf.subarray(0, 4096).toString("latin1").toLowerCase();
  return /utf-8/.test(head) ? new TextDecoder("utf-8").decode(buf) : new TextDecoder("windows-874").decode(buf);
}

const formRes = await fetch(URL_, {
  headers: { "User-Agent": UA, "Accept-Language": "th,en;q=0.8" },
  signal: AbortSignal.timeout(45000),
});
const sess = (formRes.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");

const CASES = [
  ["ผบE.390", "2568"],
  ["ผบE.2225", "2567"],
  ["ผบ.499", "2565"],
];

for (const [caseNo, year] of CASES) {
  const tag = caseNo.replace(/[^\w]/g, "_");
  await sleep(2600);
  const res = await fetch(URL_, {
    method: "POST",
    redirect: "follow",
    headers: {
      "User-Agent": UA,
      "Accept-Language": "th,en;q=0.8",
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: URL_,
      Cookie: sess,
    },
    body: new URLSearchParams({
      ALAW_SUIT_NO: caseNo,
      ALAW_SUIT_YEAR: year,
      person1: "",
      startdate: "",
      Action: " ค้นหา ",
    }),
    signal: AbortSignal.timeout(45000),
  });
  const html = await decode(res);
  writeFileSync(new URL(`./probe_case_${tag}.html`, import.meta.url), html);
  const rows = (html.match(/<tr/gi) ?? []).length;
  console.log(`\n===== ${caseNo}/${year} ===== HTTP ${res.status} bytes ${html.length} rows ${rows}`);
  const culled = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
  for (const w of ["ราคาที่ขายได้", "ราคาประมูล", "ผู้ซื้อ", "ไม่พบ", "หาไม่พบ", "ขายออก"]) {
    const i = culled.indexOf(w);
    if (i >= 0) {
      console.log(`✓ "${w}":`, culled.slice(i - 100, i + 300).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 320));
      break;
    }
  }
  /* Dump content rows as text so the table shape is visible. */
  const tbl = culled.match(/<table class="table[\s\S]{200,}?<\/table>/i)?.[0];
  if (tbl) {
    const asText = tbl.replace(/<\/tr>/gi, "\n").replace(/<\/t[dh]>/gi, " | ").replace(/<[^>]*>/g, "").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
    console.log("---- table ----");
    console.log(asText.slice(0, 1800));
  }
}
