/* benchProvince.js — measure what a full province scrape actually costs.
 *
 * Runs every page for one province and records wall time, peak RSS/heap, image
 * bytes written, and output size, so a per-province and per-country projection
 * can be made from real numbers instead of guesses.
 *
 *   node benchProvince.js [province] [maxPages]
 *
 * LED pacing is LED_DELAY_MS (default 1500ms). DOL is NOT called here — this
 * measures the LED side only.
 */
import fs from "fs";
import path from "path";

const PROVINCE = process.argv[2] || "ขอนแก่น";
const MAXPAGES = Number(process.argv[3] || 1000);
/* scrapeLED resolves outDir/img relative to CWD, so when run from test/ the
   images land in test/public/img/land, NOT the app's public/. Measure the same
   path it actually writes to. */
const IMG_DIR = path.resolve("public", "img", "land");

/* Must be set BEFORE importing scrapeLED: its CONFIG is read at module load, so
   env vars assigned after a static import are ignored and it silently runs the
   default national search instead. */
process.env.LED_PROVINCE = PROVINCE;
process.env.LED_MAX_PAGES = String(MAXPAGES);
process.env.LED_QUIET = "1";
process.env.LED_OUT = "./out/bench";

const { scrapeLED } = await import("./scrapeLED.js");

const dirSize = (d) => {
    if (!fs.existsSync(d)) return { bytes: 0, files: 0 };
    let bytes = 0, files = 0;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) {
            const s = dirSize(p);
            bytes += s.bytes;
            files += s.files;
        } else {
            bytes += fs.statSync(p).size;
            files++;
        }
    }
    return { bytes, files };
};

/* poll memory while the scrape runs */
let peakRss = 0, peakHeap = 0, samples = 0;
const timer = setInterval(() => {
    const m = process.memoryUsage();
    peakRss = Math.max(peakRss, m.rss);
    peakHeap = Math.max(peakHeap, m.heapUsed);
    samples++;
}, 250);

const before = dirSize(IMG_DIR);
const t0 = Date.now();

const res = await scrapeLED();
const elapsed = (Date.now() - t0) / 1000;

clearInterval(timer);

/* scrapeLED() only dumps page-1.html; discoverLED is what writes rows.json.
   Serialize here so the JSON cost is included in the measurement. */
fs.mkdirSync("./out/bench", { recursive: true });
fs.writeFileSync("./out/bench/rows.json", JSON.stringify(res.rows), "utf8");

const after = dirSize(IMG_DIR);
const jsonPath = "./out/bench/rows.json";
const jsonBytes = fs.existsSync(jsonPath) ? fs.statSync(jsonPath).size : 0;
const htmlPath = "./out/bench/page-1.html";
const htmlBytes = fs.existsSync(htmlPath) ? fs.statSync(htmlPath).size : 0;

const pages = res.totalPages;
const rows = Array.isArray(res.rows) ? res.rows : [];
const imgBytes = after.bytes - before.bytes;
const imgFiles = after.files - before.files;
const imgUrls = rows.reduce((n, r) => n + (r.images || []).filter((i) => i.url).length, 0);

const mb = (b) => (b / 1048576).toFixed(2);
const kb = (b) => (b / 1024).toFixed(1);

console.log(`\n================ ${PROVINCE} ================`);
console.log(`pages          ${pages}`);
console.log(`rows           ${rows.length}   (${(rows.length / pages).toFixed(1)}/page)`);
console.log(`errors         ${res.errors.length}`);
console.log(`wall time      ${elapsed.toFixed(1)} s   (${(elapsed / pages).toFixed(2)} s/page)`);
console.log(`peak RSS       ${mb(peakRss)} MB`);
console.log(`peak heap      ${mb(peakHeap)} MB`);
console.log(`memory samples ${samples}`);
console.log(`--- storage ---`);
console.log(`images dl      ${imgFiles} files, ${mb(imgBytes)} MB  (${imgUrls} urls found)`);
console.log(`  avg/img      ${imgFiles ? kb(imgBytes / imgFiles) : 0} KB`);
console.log(`rows.json      ${mb(jsonBytes)} MB  (${kb(jsonBytes / Math.max(rows.length, 1))} KB/row)`);
console.log(`page-1.html    ${mb(htmlBytes)} MB`);
console.log(`total on disk  ${mb(imgBytes + jsonBytes + htmlBytes)} MB`);

/* This run IS one province. Scale from the measured per-province totals, not
   per-page figures multiplied by province count (that conflated rows and MB). */
console.log(`\n--- projections (scaling THIS province across the country) ---`);
const provinces = JSON.parse(fs.readFileSync("./data/provinces.json", "utf8")).length;
const perProvMB = (imgBytes + jsonBytes + htmlBytes) / 1048576;
for (const n of [1, 10, provinces]) {
    console.log(
        `  ${String(n).padStart(2)} province(s): ${((elapsed * n) / 60).toFixed(1)} min, ` +
        `${Math.round(rows.length * n)} rows, ${(perProvMB * n / 1024).toFixed(1)} GB`,
    );
}
console.log(
    `\n  LED-only. กรุงเทพฯ alone has 112 pages like this, so a 78-province sweep is a\n` +
    `  lower bound: expect several hours and tens of GB once images are included.`,
);

fs.writeFileSync(
    "./out/bench-metrics.json",
    JSON.stringify(
        { province: PROVINCE, pages, rows, errors: res.errors.length, elapsedSec: elapsed,
          secPerPage: elapsed / pages, rowsPerPage: rows / pages, peakRssMB: +(peakRss / 1048576).toFixed(2),
          peakHeapMB: +(peakHeap / 1048576).toFixed(2), imageFiles: imgFiles, imageMB: +(imgBytes / 1048576).toFixed(2),
          jsonMB: +(jsonBytes / 1048576).toFixed(4), timestamp: new Date().toISOString() },
        null, 2,
    ),
    "utf8",
);
console.log("\nwrote ./out/bench-metrics.json");