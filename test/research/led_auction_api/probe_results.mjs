// probe_results.mjs — phase 3: pull the SOLD results the way the real page does.
//
// https://asset.led.go.th/report_new/report.asp ("รายงานผลการขายทอดตลาด")
//   POST with:
//     PROVINCE_ID   office code from its <select> (ขอนแก่น เมือง = 401;
//                   NOT the LED province code — branches have their own ids)
//     saledate      the auction day, dd/mm/yyyy
//     Action        " ดูผลการขาย "  (a NAMED submit button — the ASP keys on it)
//
// Cross-check source: our DB has ผบE.2225/ผบ.499/… sold on 2026-09-30 in
// province 40, so that day+office should answer a real results table.
// Run:  bun probe_results.mjs
//
import { writeFileSync } from "node:fs";

const URL_ = "https://asset.led.go.th/report_new/report.asp";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const TIMEOUT_MS = 45000;

async function decode(res) {
  const buf = Buffer.from(await res.arrayBuffer());
  const head = buf.subarray(0, 4096).toString("latin1").toLowerCase();
  return /utf-8/.test(head) ? new TextDecoder("utf-8").decode(buf) : new TextDecoder("windows-874").decode(buf);
}

const formRes = await fetch(URL_, {
  headers: { "User-Agent": UA, "Accept-Language": "th,en;q=0.8" },
  signal: AbortSignal.timeout(TIMEOUT_MS),
});
const sess = (formRes.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");

const body = new URLSearchParams({
  PROVINCE_ID: "401",          /* ขอนแก่น (เมือง) */
  saledate: "30/09/2026",      /* a day our DB says there was a sale round */
  Action: " ดูผลการขาย ",
});
await sleep(3000);
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
  body,
  signal: AbortSignal.timeout(TIMEOUT_MS),
});
const html = await decode(res);
writeFileSync(new URL("./probe_results_sample.html", import.meta.url), html);
console.log("HTTP", res.status, "bytes", html.length, "final", res.url);
const tables = (html.match(/<table/gi) ?? []).length;
const rows = (html.match(/<tr/gi) ?? []).length;
console.log(`tables=${tables} rows=${rows}`);

/* Show the results tables as text, row by row. */
const culled = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
for (const m of culled.matchAll(/<table[\s\S]*?<\/table>/gi)) {
  const txt = m[0].replace(/<tr[\s\S]*?<td/gi, "<tr><td")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " | ")
    .replace(/<[^>]*>/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n");
  console.log("---- table ----");
  console.log(txt.trim().slice(0, 2200));
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
