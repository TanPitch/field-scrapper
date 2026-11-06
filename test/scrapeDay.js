/* scrapeDay.js — the cron's brain: which provinces does LED owe us today?
 *
 * BOT-PLAN 4.1, the missing half of run-bot2.cmd. bot 2 enriches whatever the
 * queue holds; this decides what to scrape and runs backfillProvinces.js for
 * it, so the pass needs only a DATABASE_URL and no arguments.
 *
 * Due rule (a DB translation of scheduler.plan's "nearest upcoming round"):
 * a province is due when ANY of its active lots has next_round_date <= today.
 *   = today        the scheduled round is tonight (the normal path)
 *   < today        the round already happened and no scrape caught it — the
 *                  stored date is stale-ingest, so it self-heals next run
 * Once backfill+ingest finish, next_round_date jumps to the next future round
 * and the province leaves the due set by itself. Nothing else predicts dates.
 *
 * Double-run guard: ingest gets RUN_KEY=night:<date>:<code>; a province with a
 * finished, error-free run under that key is skipped, so a retriggered Task
 * Scheduler pass (or --dry followed by the real one) never scrapes twice.
 *
 *   bun scrapeDay.js            # run due provinces now
 *   bun scrapeDay.js --dry      # list them, touch nothing
 *   bun scrapeDay.js 83         # force one code, bypassing the due filter
 */
import { Client } from "pg";
import { ictNow } from "./scheduler.js";
import { spawnSync } from "child_process";

const DUE_SQL = `
    SELECT p.province_code::text AS code,
           max(p.province_name)  AS name,
           count(*)::int         AS lots
      FROM auction_lots l
      JOIN parcels p ON p.id = l.parcel_id
     WHERE l.status = 'active'
       AND l.next_round_date IS NOT NULL
       AND l.next_round_date <= current_date
     GROUP BY p.province_code`;

const alreadyDone = async (client, runKey) => {
    const { rows } = await client.query(
        `SELECT 1 FROM scrape_runs
          WHERE run_key = $1 AND finished_at IS NOT NULL AND error_count = 0`,
        [runKey]);
    return rows.length > 0;
};

const main = async () => {
    const url = process.env.DATABASE_URL;
    if (!url) { console.error("DATABASE_URL is required"); process.exit(1); }

    const args = process.argv.slice(2);
    const dry = args.includes("--dry");
    const forced = args.filter(a => /^\d+$/.test(a));
    const today = ictNow().date;

    const client = new Client({ connectionString: url });
    await client.connect();

    let jobs;
    if (forced.length) {
        /* Force names come straight from the scraper's own province list so
           LED_PROVINCE gets the human text, same as a manual backfill run. */
        const all = JSON.parse((await import("fs")).default.readFileSync("./data/provinces.json", "utf8"));
        jobs = all.filter(p => forced.includes(p.value)).map(p => ({ code: p.value, name: p.text, lots: -1 }));
    } else {
        const { rows } = await client.query(DUE_SQL);
        jobs = rows;
    }

    console.log(`== scrapeDay ${today} (ICT) — ${jobs.length} province(s) ==`);
    for (const j of [...jobs]) console.log(`  ${j.code.padEnd(3)} ${j.name}  (${j.lots} active lots due)`);
    const alive = [];
    for (const j of jobs) {
        if (await alreadyDone(client, `night:${today}:${j.code}`)) console.log(`skip  ${j.code} ${j.name} — already run tonight`);
        else alive.push(j);
    }
    jobs = alive;
    if (dry) { await client.end(); return; }
    if (!jobs.length) { console.log("nothing to do"); await client.end(); return; }

    let failed = 0;
    for (const j of jobs) {
        console.log(`\n-- ${j.name} (${j.code}) --`);
        const r = spawnSync("bun", ["backfillProvinces.js", j.code], {
            stdio: "inherit",
            env: { ...process.env, RUN_KEY: `night:${today}:${j.code}`, PROVINCE_CODE: String(j.code) },
        });
        if (r.status !== 0) { failed++; console.log(`FAILED exit ${r.status}`); }
    }
    const last = await client.query(
        `SELECT count(*)::int AS n FROM scrape_runs
          WHERE run_key LIKE 'night:' || $1 || ':%' AND finished_at IS NOT NULL`,
        [today]);
    console.log(`\n== scrapeDay done: ${last.rows[0].n} run row(s), ${failed} failed province pass(es) ==`);
    await client.end();
    if (failed) process.exit(1);
};

await main();
