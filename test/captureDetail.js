/* captureDetail.js — everything LED's per-lot detail page carries.
 *
 *   DATABASE_URL=... bun captureDetail.js <deedNumber> <provinceCode>
 *
 * The list row has no โฉนดเลขที่ of its own. The detail page is where LED
 * publishes the land's identity, so this dumps all of it: every hidden input,
 * every visible line, and every link the page offers. The point is to find the
 * แปลงที่ดิน - the number TD wants as SURVEY_NO - rather than guess which field
 * it is.
 */
import { LedClient, LED_BASE } from "./ledClient.js";
import { Client } from "pg";

const deed = process.argv[2] ?? "34062";
const provCode = process.argv[3] ?? "83";
const line = (s) => console.log("  " + s);
/* Amphur / tambon narrowing. ขอนแก่น alone lists 121 pages; a deed can sit past
   page 30 and never be reached. LED's own search form takes ampur/tumbol as
   POST fields (scrapeByProvince deletes them to see the whole province), so
   naming them here shrinks the listing to a handful of pages.
     bun captureDetail.js <deed> <province> [ampur] [tumbol]   */
const ampurArg = process.argv[4] ?? "";
const tumbolArg = process.argv[5] ?? "";
/* LED_PAGES: one page ≈ 1.2 s of politeness, so raising the cap only ever
   costs pacing time. Default is ample for a narrowed search. */
const maxPages = Number(process.env.LED_PAGES || 30);

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const { rows: provRows } = await db.query("SELECT name FROM provinces WHERE code = $1", [Number(provCode)]);
const provName = provRows[0]?.name ?? provCode;

const led = new LedClient({ baseDelayMs: 1200, verbose: false });
await led.open();

const fields = {
  province: provName, ampur: ampurArg, tumbol: tumbolArg, asset_type: "", person1: "", bid_date: "",
  price_begin: "", price_end: "", rai_if: "1", rai: "", quaterrai_if: "1", quaterrai: "",
  wa_if: "1", wa: "", search: "ok", page: "1",
};
fields.oseckey = led.seckey;
fields.seckey = led.seckey;

let res = null, found = null;
for (let pg = 1; pg <= maxPages && !found; pg++) {
  fields.page = String(pg);
  res = await led.search(fields, { expectRows: false });
  if (!res.rowCount) break;
  const $ = res.$;
  $("tr").filter((i, e) => $(e).find('input[name="deedno"]').length).each((i, e) => {
    const d = $(e).find('input[name="deedno"]').attr("value");
    if (String(d).trim() === String(deed) && !found) found = $(e);
  });
  if (!found) await led.pace();
}

if (!found) {
  line(`deed ${deed} not found in ${provName}`);
  process.exit(0);
}

const $ = res.$;
const formFields = {};
found.find("input[name]").each((i, e) => { formFields[$(e).attr("name")] = $(e).attr("value") ?? ""; });
line(`deed ${deed}: the list row's hidden inputs`);
Object.entries(formFields).forEach(([k, v]) => line(`   ${k} = ${v}`));

line(`\nPOST ${new URL("asset_open.asp", LED_BASE).toString()}`);
const $d = await led.detail(formFields);
if (!$d) { line("no detail page"); process.exit(0); }

line("\n--- every hidden input on the detail page ---");
const ins = {};
$d("input[name]").each((i, e) => { ins[$(e).attr("name")] = $(e).attr("value") ?? ""; });
Object.entries(ins).forEach(([k, v]) => line(`   ${k} = ${v}`));

line("\n--- every link on the detail page ---");
$d("a").each((i, e) => {
  const href = $(e).attr("href");
  const txt = $(e).text().replace(/\s+/g, " ").trim();
  if (href) line(`   [${txt}] -> ${href}`);
});

line("\n--- every visible line ---");
const texts = [];
$d("body").text().split(/\r?\n/).forEach((t) => { const s = t.replace(/\s+/g, " ").trim(); if (s) texts.push(s); });
texts.forEach((t) => line(`   ${t}`));

await led.close?.();
await db.end();