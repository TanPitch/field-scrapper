// LED Auction Results - Node 18+ fetch sample (companion, no dependencies)
// Report: "LED Auction Results API - Integration and Reference Report"
//
// STATUS: scaffold. RESULT_URL and parameter names are placeholders -
// capture them once via DevTools (report Section 3.3) before production.
//
// Run:  node led_auction_fetch.mjs

const BASE = "https://asset.led.go.th";
const FORM_URL = BASE + "/report/reports.asp";
// TODO(verify): capture in DevTools > Network before production use.
const RESULT_URL = BASE + "/report/report_result.asp"; // PLACEHOLDER
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const MIN_INTERVAL_MS = 2500; // politeness - report Chapter 8
const TIMEOUT_MS = 45000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Minimum interval + jitter between outbound calls. */
async function polite() {
  await sleep(MIN_INTERVAL_MS + Math.random() * 750);
}

/** Charset ladder: header charset, meta tag, default UTF-8 (Section 3.2). */
async function decode(res) {
  const buf = Buffer.from(await res.arrayBuffer());
  const head = buf.subarray(0, 2048).toString("latin1").toLowerCase();
  if (/windows-874|tis-620/.test(head)) {
    return new TextDecoder("windows-874").decode(buf);
  }
  return new TextDecoder("utf-8").decode(buf);
}

/** Fetch the search form and return the session cookie for reuse. */
export async function loadFormCookie() {
  const res = await fetch(FORM_URL, {
    headers: { "User-Agent": UA, "Accept-Language": "th,en;q=0.8" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} on form`);
  const cookies = res.headers
    .getSetCookie?.()
    .map((c) => c.split(";")[0])
    .join("; ");
  const html = await decode(res);
  return { html, cookie: cookies ?? "" };
}

/**
 * Submit the per-case search (E2) and return the raw results HTML.
 * TODO(verify): rename params to the captured field names.
 */
export async function searchByCase(params, cookie) {
  await polite();
  const body = new URLSearchParams(params); // { case_no, year_be, ... }
  const res = await fetch(RESULT_URL, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Accept-Language": "th,en;q=0.8",
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookie,
    },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} on results`);
  return decode(res);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log("LED Auction Results fetch sample - pre-verification checklist:");
  console.log("1. DevTools > Network, submit one real search on the live form.");
  console.log("2. Replace RESULT_URL and parameter names with captured values.");
  console.log("3. Parse rows with cheerio/DOMParser anchored to real headers.");
  console.log("4. Keep >= 2.5 s between requests; cache immutable results.");
  const { html, cookie } = await loadFormCookie();
  console.log("form loaded:", html.length, "chars; cookie:", cookie || "(none)");
}
