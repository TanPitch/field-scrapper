// probe_results2.mjs — narrow the POST matrix that answered "Error Pages".
// Standalone (no imports) so it runs anywhere; one GET first for the session
// cookie, then skip-less POST variants with 2.5s politeness between.
//
import { writeFileSync } from "node:fs";

const URL_ = "https://asset.led.go.th/report_new/report.asp";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function decode(res) {
  const buf = Buffer.from(await res.arrayBuffer());
  const head = buf.subarray(0, 4096).toString("latin1").toLowerCase();
  return /utf-8/.test(head) ? new TextDecoder("utf-8").decode(buf) : new TextDecoder("windows-874").decode(buf);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const formRes = await fetch(URL_, {
  headers: { "User-Agent": UA, "Accept-Language": "th,en;q=0.8" },
  signal: AbortSignal.timeout(45000),
});
const sess = (formRes.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
const formHtml = await decode(formRes);
const referer = URL_;

const VARIANTS = [
  { tag: "std", PROVINCE_ID: "401", saledate: "30/09/2026", Action: " ดูผลการขาย " },
  { tag: "nospace", PROVINCE_ID: "401", saledate: "30/09/2026", Action: "ดูผลการขาย" },
  { tag: "dashdate", PROVINCE_ID: "401", saledate: "30-09-2566", Action: " ดูผลการขาย " },
  { tag: "be-year", PROVINCE_ID: "401", saledate: "30/09/2566", Action: " ดูผลการขาย " },
  { tag: "other-day", PROVINCE_ID: "401", saledate: "01/09/2026", Action: " ดูผลการขาย " },
  { tag: "empty-date", PROVINCE_ID: "999", saledate: "", Action: " ดูผลการขาย " },
];

for (const v of VARIANTS) {
  await sleep(2500);
  const res = await fetch(URL_, {
    method: "POST",
    redirect: "follow",
    headers: {
      "User-Agent": UA,
      "Accept-Language": "th,en;q=0.8",
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: referer,
      Cookie: sess,
    },
    body: new URLSearchParams({ ...v, tag: undefined }),
    signal: AbortSignal.timeout(45000),
  });
  const html = await decode(res);
  writeFileSync(new URL(`./probe_res_${v.tag}.html`, import.meta.url), html);
  const rows = (html.match(/<tr/gi) ?? []).length;
  const txt = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  console.log(`${v.tag}: HTTP ${res.status} bytes ${html.length} rows ${rows} :: ${txt.slice(0, 220)}`);
}
