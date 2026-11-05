// probe_sold_price.mjs — verify https://asset.led.go.th/report/reports.asp live.
//
// The scaffold (led_auction_fetch.mjs) has the DECORATE_RIGHT parts (charset
// ladder, politeness, cookie capture) and PLACEHOLDER parts (result URL, param
// names). This probe fills the placeholders by reading the real form: step 1
// prints every <form action>, field name and select option the page offers;
// step 2 (probeResults) submits one search the way the form says to and saves
// the raw HTML for the parser work.
//
// Run:  bun probe_sold_price.mjs            (print the form inventory)
//       bun probe_sold_price.mjs <caseNo> <year> [office]
//
import { writeFileSync } from "node:fs";

const BASE = "https://asset.led.go.th";
const FORM_URL = BASE + "/report/reports.asp";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const TIMEOUT_MS = 45000;

async function decode(res) {
  const buf = Buffer.from(await res.arrayBuffer());
  const head = buf.subarray(0, 4096).toString("latin1").toLowerCase();
  if (/windows-874|tis-620/.test(head)) return new TextDecoder("windows-874").decode(buf);
  if (/utf-8/.test(head) || buf.includes(Buffer.from("charset=utf-8"))) {
    return new TextDecoder("utf-8").decode(buf);
  }
  return new TextDecoder("windows-874").decode(buf);
}

const getSetCookie = (res) =>
  (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");

/** Inventory of the live form: actions, inputs, selects. */
function inventory(html) {
  const forms = [...html.matchAll(/<form[^>]*>/gi)].map((m) => m[0]);
  const inputs = [...html.matchAll(/<(?:input|select|textarea)\b[^>]*>/gi)].map((m) =>
    m[0].replace(/\s+/g, " ").slice(0, 200)
  );
  const selects = [...html.matchAll(/<select\b[^>]*>([\s\S]*?)<\/select>/gi)].map((m) => ({
    tag: m[0].split(">")[0] + ">",
    options: [...m[1].matchAll(/<option[^>]*value=["']?([^"'>]*)/gi)].map((o) => o[1]).slice(0, 12),
  }));
  return { forms, inputs, selects };
}

const { html, cookie } = await (async () => {
  const res = await fetch(FORM_URL, {
    headers: { "User-Agent": UA, "Accept-Language": "th,en;q=0.8" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} loading the form`);
  return { html: await decode(res), cookie: getSetCookie(res) };
})();

console.log("form bytes:", html.length, "cookie:", cookie || "(none)");
const inv = inventory(html);
console.log("\n== forms ==", inv.forms.join("\n"));
console.log("\n== fields ==");
for (const t of inv.inputs) console.log(" ", t);
console.log("\n== selects ==");
for (const s of inv.selects) console.log(" ", s.tag, "→", s.options.join(", "));

/* Submit one search when argv gave a case. The form inventory above tells us
 * the real action path (often reports.asp itself, hidden fields included) —
 * so POST to whatever <form action> the page named, defaulting to reports.asp. */
const [caseNo, year, office] = process.argv.slice(2);
if (caseNo) {
  const action = (inv.forms[0]?.match(/action=["']?([^"' >]+)/)?.[1] ?? "reports.asp")
    .replace(/^https?:\/\/asset\.led\.th/i, BASE);
  const url = action.startsWith("http") ? action : new URL(action, FORM_URL).href;
  /*Guess the field names from the inventory: pick inputs whose name mentions
   * case/id/text. Hidden probes are included verbatim so ASP session checks pass. */
  const body = new URLSearchParams();
  for (const raw of inv.inputs) {
    const name = raw.match(/name=["']?([^"' >]+)/)?.[1];
    if (!name) continue;
    const value = raw.match(/value=["']?([^"'>]+)/)?.[1];
    body.set(name, caseNo.toLowerCase().includes(name.toLowerCase()) ? caseNo : (value ?? ""));
  }
  // overwrite with our search terms against the most likely text fields
  for (const key of [...body.keys()]) {
    if (/case|id|search|txt/i.test(key) && body.get(key) === "") body.set(key, caseNo);
    if (/year|be|prat;/i.test(key)) body.set(key, year ?? "");
    if (/office|branch/i.test(key) && office) body.set(key, office);
  }
  console.log("\n== POST ==", url, body.toString());
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Accept-Language": "th,en;q=0.8",
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: FORM_URL,
      Cookie: cookie,
    },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const result = await decode(res);
  writeFileSync(new URL("./probe_result_sample.html", import.meta.url), result);
  console.log("\nresult bytes:", result.length, "cookie:", getSetCookie(res) || "(none)");
  /* Cheap sniff for sold-price words rather than a full parse yet. */
  for (const word of ["ราคาที่ขายได้", "ราคาขายได้", "ผู้ซื้อ", "ขายได้", "sold"]) {
    const i = result.indexOf(word);
    console.log(word, "->", i < 0 ? "not found" : result.slice(i - 120, i + 160).replace(/\s+/g, " "));
  }
  console.log("\nsaved sample HTML to probe_result_sample.html");
}
