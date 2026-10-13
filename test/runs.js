/* runs.js — record what the scraper is doing, so the frontend can show it.
 *
 *   node runs.js
 *
 * Every pass of every bot (province scrape, TD enrichment, image fetch) opens a
 * row here when it starts and closes it when it ends. The API turns those rows
 * into the status page.
 *
 * A row with finished_at IS NULL is the signal for "running now". Nothing
 * touches finished_at until the work is genuinely done, so a killed process
 * leaves a visible stuck row rather than a silent gap — which is the failure
 * mode that actually matters when you are trying to trust the page.
 *
 * Progress is written through `step()` on the same row rather than buffered, so
 * `last_step` reflects the pass as it happens and a crash keeps whatever the
 * last checkpoint said.
 */
import pg from "pg";
const { Client } = pg;

/** Open a run. Returns its id. Callers must finish it, even on failure.
 *
 *  Supplying `runKey` makes this pass identifiable and re-runnable: a repeat run
 *  restarts the same row (clearing the old outcome) instead of failing on the
 *  unique index or stacking up a row per attempt. Leave it null for one-shot
 *  runs you want counted individually. */
export async function beginRun(client, { stage = "scrape", provinceCode = null, runKey = null, notes = null } = {}) {
    if (runKey) {
        const { rows } = await client.query(
            `INSERT INTO scrape_runs (stage, run_key, province_code, started_at, started_at_t, notes)
             VALUES ($1, $2, $3, now(), now(), $4)
             ON CONFLICT (run_key) WHERE run_key IS NOT NULL DO UPDATE
                SET started_at_t = now(), finished_at = NULL, last_step = NULL,
                    pages = NULL, lots_seen = NULL, lots_new = NULL, lots_closed = NULL,
                    error_count = 0, detail = '{}'::jsonb, notes = excluded.notes
             RETURNING id`,
            [stage, runKey, provinceCode, notes]);
        return rows[0].id;
    }
    const { rows } = await client.query(
        `INSERT INTO scrape_runs (stage, run_key, province_code, started_at, started_at_t, notes)
         VALUES ($1, NULL, $2, now(), now(), $3)
         RETURNING id`,
        [stage, provinceCode, notes]);
    return rows[0].id;
}

/**
 * Record visible progress. `text` is shown verbatim in the UI, so keep it short
 * and specific — "page 41/112" beats "scraping".
 */
export async function step(client, runId, text) {
    if (runId == null) return;
    await client.query(`UPDATE scrape_runs SET last_step = $2 WHERE id = $1`, [runId, text]);
}

/**
 * Close a run. Safe to call in a finally block: if the pass threw, pass the
 * error and the row still closes, carrying why.
 */
export async function finishRun(client, runId, {
    pages = null, lotsSeen = null, lotsNew = null, lotsClosed = null,
    errorCount = 0, detail = {}, error = null,
} = {}) {
    if (runId == null) return;
    const payload = error ? { ...detail, error: String(error.message ?? error) } : detail;
    await client.query(
        `UPDATE scrape_runs
            SET finished_at = now(),
                pages = $2, lots_seen = $3, lots_new = $4, lots_closed = $5,
                error_count = $6, detail = $7,
                last_step = coalesce(last_step, $8)
          WHERE id = $1`,
        [runId, pages, lotsSeen, lotsNew, lotsClosed, errorCount,
            JSON.stringify(payload), error ? `failed: ${error.message ?? error}` : "done"]);
}

/**
 * Run `fn` with a run row wrapped around it. The call site does not have to
 * remember to close the row, which is the only way to guarantee none is left
 * open by an ordinary throw.
 */
export async function withRun(client, opts, fn) {
    const id = await beginRun(client, opts);
    const tick = (text) => step(client, id, text).catch(() => {});
    try {
        const detail = await fn(tick);
        await finishRun(client, id, detail ?? {});
        return detail;
    } catch (e) {
        await finishRun(client, id, { error: e, errorCount: 1 }).catch(() => {});
        throw e;
    }
}

/* ---- CLI ------------------------------------------------------------------
 * Mark every run row still open as failed. Needed after a hard kill (Ctrl-C on
 * a fetch, machine off) where no code path got to close them — otherwise the UI
 * shows the bot as running forever.
 *
 *   node runs.js reap
 */
if (import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1]).href) {
    const url = process.env.DATABASE_URL;
    if (!url) {
        console.error("DATABASE_URL is required");
        process.exit(1);
    }
    const client = new Client({ connectionString: url });
    await client.connect();

    if (process.argv[2] === "reap") {
        const { rowCount } = await client.query(
            `UPDATE scrape_runs
                SET finished_at = now(),
                    last_step = coalesce(last_step, '') || ' (abandoned)',
                    detail = detail || jsonb_build_object('abandoned', true)
              WHERE finished_at IS NULL`);
        console.log(`reaped ${rowCount} unfinished run(s)`);
    } else {
        const { rows } = await client.query(`
            SELECT id, stage, province_code, started_at_t,
                   extract(epoch FROM now() - started_at_t)::int AS age_s, last_step
              FROM scrape_runs ORDER BY started_at_t DESC LIMIT 20`);
        for (const r of rows) {
            const state = r.finished_at === null ? "RUNNING" : "done";
            console.log(`#${r.id} ${r.stage.padEnd(12)} ${state.padEnd(8)} ${r.age_s}s  ${r.last_step ?? ""}`);
        }
    }
    await client.end();
}
