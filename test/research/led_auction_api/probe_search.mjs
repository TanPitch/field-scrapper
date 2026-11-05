// probe_search.mjs — phase 2: submit real searches to asset.led.go.th and
// capture how a sold-price answer looks.
//
// Phase 1 established the live form:
//   POST  https://asset.led.go.th/report/reports.asp   (name="report_search")
//   ALAW_SUIT_NO   text  หมายเลขคดีแดง        (required with YEAR)
//   ALAW_SUIT_YEAR text  พ.ศ. (e.g. 2566)      (required with NO)
//   person1        text  ชื่อโจทก์            (required with startdate)
//   hidden: program_name=report, page_name=ค้นหาทรัพย์ขายทอดตลาดกรมบังคับคดี
//
// The POST body goes UTF-8: the server echoed our windows-874 bytes as '??'
// characters, so ASP reads Request.Form() as UTF-8 even though the page itself
// is served windows-874. (Thai argv from PowerShell arrives mangled, which is
// why the probe list lives in this file.)
//
// Run:  bun probe_search.mjs
//
import { writeFileSync } from "node:fs";

const FORM_URL = "https://asset.led.go.th/report/reports.asp";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const TIMEOUT_MS = 45000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Real closed cases from our own DB (auction_lots.close_reason='sold') —
 * query: SELECT case_no, case_year ... WHERE close_reason='sold' ... */
const PROBES = [
  ["ผบE.92", "2566"], ["ผบE.1590", "2567"], ["ผบ.40", "2568"],
];

async function decode(res) {
  const buf = Buffer.from(await res.arrayBuffer());
  const head = buf.subarray(0, 4096).toString("latin1").toLowerCase();
  if (/utf-8/.test(head)) return new TextDecoder("utf-8").decode(buf);
  return new TextDecoder("windows-874").decode(buf);
}

const formRes = await fetch(FORM_URL, {
  headers: { "User-Agent": UA, "Accept-Language": "th,en;q=0.8" },
  signal: AbortSignal.timeout(TIMEOUT_MS),
});
if (!formRes.ok) throw new Error(`HTTP ${formRes.status} on form`);
const sess = (formRes.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");

for (const [caseNo, year] of PROBES) {
  const tag = caseNo.replace(/[^\w]/g, "_");
  await sleep(2600);
  const body = new URLSearchParams({
    program_name: "report",
    page_name: "ค้นหาทรัพย์ขายทอดตลาดกรมบังคับคดี",
    ALAW_SUIT_NO: caseNo,
    ALAW_SUIT_YEAR: year,
    person1: "",
    startdate: "",
  });
  const res = await fetch(FORM_URL, {
    method: "POST",
    redirect: "follow",
    headers: {
      "User-Agent": UA,
      "Accept-Language": "th,en;q=0.8",
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: FORM_URL,
      Cookie: sess,
    },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const html = await decode(res);
  writeFileSync(new URL(`./probe_search_${tag}.html`, import.meta.url), html);
  const tables = (html.match(/<table/gi) ?? []).length;
  const rows = (html.match(/<tr/gi) ?? []).length;
  /* Where the case number got echoed back tells us what the search ran on. */
  const echo = html.match(/ALAW_SUIT_NO[^>]*value="([^"]*)"/)?.[1];
  console.log(`\n===== ${caseNo}/${year} =====`);
  console.log(`HTTP ${res.status} bytes ${html.length} tables=${tables} rows=${rows} echo="${echo}"`);
  for (const w of ["ราคาที่ขายได้", "ราคาขายได้", "ผู้ซื้อ", "ผู้เสนอราคา", "ขายออก", "ไม่พบ"]) {
    const i = html.indexOf(w);
    if (i >= 0) {
      const ctx = html.slice(Math.max(0, i - 120), i + 240).replace(/\s+/g, " ").replace(/<[^>]*>/g, " ");
      console.log(`  ✓ "${w}": …${ctx.trim().slice(0, 240)}…`);
      break;
    }
  }
}
