/* backfillProvinces.js — scrape + ingest, one province at a time, end to end.
 *
 * The two halves existed but were not wired together: scrapeLED() *returns*
 * rows and writes only page-1.html, while ingest.js reads ./out/rows.json.
 * Nothing produced that file, so a scrape never reached the database. This
 * driver is the missing link.
 *
 * Each province runs as its own pass so one failure cannot take down the rest,
 * and every pass is recorded in the manifest before the next begins — an
 * interrupted run leaves an accurate record of what actually got written.
 *
 *   bun backfillProvinces.js 83              # one province by id
 *   bun backfillProvinces.js 92 50 83 60 41  # several
 *   bun backfillProvinces.js --all           # all 78 (long; see the note below)
 *   bun backfillProvinces.js --list          # ids only, touches nothing
 *
 * Pace comes from scrapeLED's politeDelay. Between provinces this driver waits
 * its own, longer, because a province boundary opens a fresh session.
 */
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

const LIST = "./data/provinces.json";
const OUT = process.env.LED_OUT || "./out";
const ROWS = path.join(OUT, "rows.json");
const MANIFEST = path.join(OUT, "backfill-manifest.json");

/** Longer than the per-page gap; see the note in scrapeByProvince.js. */
const PROVINCE_DELAY_MS = Number(process.env.LED_PROVINCE_DELAY_MS || 12000);

const politeDelay = (ms, spread = 0.6) => {
    const lo = ms * (1 - spread);
    const hi = ms * (1 + spread);
    return new Promise(r => setTimeout(r, Math.round(Math.max(ms * 0.25, lo + Math.random() * (hi - lo)))));
};

const loadProvinces = () => JSON.parse(fs.readFileSync(LIST, "utf8"));

const readManifest = () => {
    try {
        return JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
    } catch {
        return [];
    }
};
const writeManifest = (m) => fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 2), "utf8");

/** Run ingest.js as a child so its DB client and run bookkeeping stay untouched. */
function ingest() {
    const r = spawnSync("bun", ["ingest.js", ROWS], {
        stdio: "inherit",
        env: process.env,
    });
    return r.status === 0;
}

/**
 * Hand this pass's parcels to bot 2 by filling the coordinate queue.
 *
 * The queue is global and enqueueUnresolved is idempotent, so one whole-database
 * pass after each province is correct and cheap, and it also picks up whatever
 * earlier passes left unresolved. Scoping it to this province would need the
 * province's parcel ids pulled back out of the database to say the same thing.
 *
 * Failure here must not turn a successful scrape into a failed one: the parcels
 * are already written, and the next pass or the daily resolveCoordsCLI run will
 * queue them. So it reports and moves on.
 */
async function fillCoordQueue() {
    const url = process.env.DATABASE_URL;
    if (!url) return null;
    let client;
    try {
        const pg = (await import("pg")).default;
        client = new pg.Client({ connectionString: url });
        await client.connect();
        const { enqueueUnresolved } = await import("./coordQueue.js");
        return (await enqueueUnresolved(client)).length;
    } catch (err) {
        console.log(`      coord queue not filled: ${String(err.message).slice(0, 70)}`);
        return null;
    } finally {
        await client?.end().catch(() => {});
    }
}

async function runProvince(prov) {
    /* Set per-pass rather than mutating CONFIG, so a failed province cannot
     * leave the next one pointed at the wrong region. */
    process.env.LED_PROVINCE = prov.text;
    process.env.LED_QUIET = "1";
    const { scrapeLED } = await import("./scrapeLED.js");

    /* LED_QUIET suppresses scrapeLED's own per-page chatter, which left a
     * province looking hung for minutes with no way to tell whether it was
     * working or stuck. Report progress and an ETA instead: the site's own
     * totalpage is known after page 1, so the remaining pages can be counted
     * down, and images are usually the bulk of the wall-clock time. */
    const t0 = Date.now();
    const origLog = console.log;
    let lastPct = -1;
    const report = (pct, note) => {
        const step = Math.floor(pct / 5) * 5;
        if (step === lastPct && pct < 100) return;
        lastPct = step;
        const el = (Date.now() - t0) / 1000;
        const eta = pct > 0 ? Math.round(el * (100 - pct) / pct) : null;
        origLog(`    ${String(pct).padStart(3)}%  ${String(Math.round(el)).padStart(4)}s elapsed` +
            (eta !== null ? `  ~${eta}s left` : "") + (note ? `  ${note}` : ""));
    };

    console.log = (...a) => {
        const s = a.join(" ");
        const pg = s.match(/Page (\d+)\/(\d+)/) ?? s.match(/Fetching Page (\d+)\/(\d+)/);
        if (pg) report(Math.round((Number(pg[1]) / Number(pg[2])) * 100), s.slice(0, 40));
        else if (/images/i.test(s)) origLog(`    ${s.slice(0, 70)}`);
    };

    let rows, errors, totalPages;
    try {
        ({ rows, errors, totalPages } = await scrapeLED());
    } finally {
        console.log = origLog;
    }
    report(100, `${rows.length} rows, ${errors.length} errors`);
    return { rows, errors, totalPages };
}

const main = async () => {
    const args = process.argv.slice(2);
    const all = loadProvinces();

    if (args.includes("--list")) {
        for (const p of all) console.log(`${p.value}\t${p.text}`);
        return;
    }

    const wantAll = args.includes("--all");
    const ids = args.filter(a => /^\d+$/.test(a));
    if (!wantAll && !ids.length) {
        console.error("Give province ids, --all, or --list. See the header comment.");
        process.exit(1);
    }
    /* jobs resolved below, after the manifest is loaded (nightly --all
     * resumes from the manifest). */

    const unknown = ids.filter(id => !all.some(p => p.value === id));
    if (unknown.length) {
        console.error(`Not in the site's province list: ${unknown.join(", ")}`);
        process.exit(1);
    }

    fs.mkdirSync(OUT, { recursive: true });
    const manifest = readManifest();

    /* Nightly --all is the cron form: skip every province the manifest already
     * recorded as ingested, so the next evening continues WHERE the previous
     * pass left off and a finished backfill costs one cheap no-op run. Explicit
     * ids always re-scrape (that is what asking for ids means). */
    let jobs;
    if (wantAll) {
        const done = new Set(manifest.filter(m => m.ingested).map(m => String(m.provinceId)));
        jobs = all.filter(p => !done.has(String(p.value)));
        const skipped = all.length - jobs.length;
        if (skipped) console.log(`  (skipping ${skipped} already ingested)`);
        if (!jobs.length) { console.log("== all provinces already ingested =="); return; }
    } else {
        jobs = all.filter(p => ids.includes(p.value));
    }

    console.log(`== ${jobs.length} province pass(es) ==`);

    for (const [i, prov] of jobs.entries()) {
        await politeDelay(PROVINCE_DELAY_MS);
        const started = Date.now();
        process.stdout.write(`  ${prov.text.padEnd(14)} (${prov.value}) `);
        try {
            const { rows, errors, totalPages } = await runProvince(prov);
            fs.writeFileSync(ROWS, JSON.stringify(rows), "utf8");

            const ok = ingest();
            /* Bot 2's work list, filled here rather than inside ingest: the
             * scraper should not know a queue exists, and one call per province
             * is the natural cadence. Only on a clean ingest - a half-written
             * province has nothing worth resolving yet. */
            const queued = ok ? await fillCoordQueue() : null;
            const entry = {
                province: prov.text,
                provinceId: prov.value,
                rows: rows.length,
                totalPages,
                parseErrors: errors.length,
                ingested: ok,
                queuedForCoords: queued,
                seconds: +((Date.now() - started) / 1000).toFixed(1),
                at: new Date().toISOString(),
            };
            manifest.push(entry);
            writeManifest(manifest);
            console.log(`${rows.length} rows -> ${ok ? "ingested" : "INGEST FAILED"} (${entry.seconds}s)` +
                (queued == null ? "" : `  |  ${queued} waiting on coordinates`));
            if (errors.length) console.log(`      ${errors.length} page-level error(s)`);
        } catch (err) {
            manifest.push({
                province: prov.text, provinceId: prov.value, rows: 0,
                ingested: false, error: String(err.message).slice(0, 200),
                at: new Date().toISOString(),
            });
            writeManifest(manifest);
            console.log(`FAILED ${String(err.message).slice(0, 80)}`);
        }
    }

    const done = manifest.filter(m => m.ingested).length;
    console.log(`\n== this run: ${done}/${jobs.length} ingested ==`);
    console.log(`   manifest: ${MANIFEST}`);
};

main();