// probe_case3.mjs — the POST that finally matters: /report_new/reports.asp
// per-case search for ผบE.390/2568, whose browser result the USER confirmed
// (6 rows, sold price 1,540,000, first round งดขาย-in-remaining etc).
// Encoding is the variable: the page is windows-874, so a real browser POSTs
// Thai as TIS-620 bytes while fetch/URLSearchParams default to UTF-8. Both are
// tried on separate fresh sessions.
//
import { writeFileSync } from "node:fs";

const URL_ = "https://asset.led.go.th/report_new/reports.asp";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* TIS-620 (windows-874) byte adapter — Thai block maps linearly. */
function tis(s) {
  return Buffer.from([...s].map((ch) => {
    const c = ch.codePointAt(0);
    if (c >= 0x0e01 && c <= 0x0e3a) return c - 0x0e01 + 0xa1;
    if (c >= 0x0e3f && c <= 0x0e5b) return c - 0x0e3f + 0xdf;
    return c < 128 ? c : 0x3f;
  }));
}
/* urlencoded body with TIS-620 percent-escapes for non-ASCII bytes. */
const body874 = (fields) =>
  Buffer.from(Object.entries(fields).map(([k, v]) =>
    `${enc(k)}=${enc(v)}`).join("&"));
const pct = (b) => (/[\w.~-]/.test(String.fromCharCode(b)) && b < 128 ? String.fromCharCode(b) : "%" + b.toString(16).toUpperCase().padStart(2, "0"));
const enc = (s) => [...tis(s)].map(pct).join("");

async function decode(res) {
  const buf = Buffer.from(await res.arrayBuffer());
  return /utf-8/.test(buf.subarray(0, 4096).toString("latin1").toLowerCase())
    ? new TextDecoder("utf-8").decode(buf)
    : new TextDecoder("windows-874").decode(buf);
}

async function run(tag, fields, encode874) {
  const menu = await fetch("https://asset.led.go.th/report_new/reportm.asp", { headers: { "User-Agent": UA, "Accept-Language": "th,en;q=0.8" }, signal: AbortSignal.timeout(45000) });
  const cs = menu.headers.getSetCookie?.() ?? [];
  const cookie = cs.map((c) => c.split(";")[0]).join("; ");
  await menu.arrayBuffer();
  await sleep(1200);
  const body = encode874 ? body874(fields) : new URLSearchParams(fields).toString();
  const res = await fetch(URL_, {
    method: "POST",
    redirect: "follow",
    headers: {
      "User-Agent": UA, "Accept-Language": "th,en;q=0.8",
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: URL_, Cookie: cookie,
    },
    body,
    signal: AbortSignal.timeout(45000),
  });
  const html = await decode(res);
  writeFileSync(new URL(`./probe_case3_${tag}.html`, import.meta.url), html);
  const echo = html.match(/ALAW_SUIT_NO[^>]*value="([^"]*)"/)?.[1];
  const rows = (html.match(/<tr/gi) ?? []).length;
  const hit = html.includes("1,540,000") || html.includes("1540000");
  const tail = html.replace(/<script[\s\S]*?<\/script>/gi, " ").slice(html.indexOf("ค้นหา") > 0 ? html.indexOf("รายงานผล") : 0);
  console.log(`[${tag}] HTTP ${res.status} bytes ${html.length} rows ${rows} echo="${echo}" soldPrice=${hit}`);
  const linktable = html.match(/<table class="table[\s\S]{100,}?<\/table>/i)?.[0];
  if (linktable && rows > 1) {
    const txt = linktable.replace(/<\/tr>/gi, "\n").replace(/<\/t[dh]>/gi, " | ").replace(/<[^>]*>/g, "").replace(/[ \t]+/g, " ").trim();
    console.log(txt.slice(0, 1600));
  }
}

const CASES = [
  ["ผบE.390", "2568"],
  ["ผบE.2311", "2566"],
  ["ผบ.2545", "2562"],
];
let n = 0;
for (const [no, yr] of CASES) {
  if (n++) await sleep(2600);
  await run(`${no.replace(/\./g, "")}_${yr}`, { ALAW_SUIT_NO: no, ALAW_SUIT_YEAR: yr, person1: "", startdate: "", Action: " ค้นหา " }, true);
}
