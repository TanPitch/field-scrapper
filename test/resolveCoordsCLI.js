/* resolveCoordsCLI.js — run the coordinate queue, TD first and DOL second.
 *
 *   DATABASE_URL=postgres://... bun resolveCoordsCLI.js
 *
 * The order matters. TD (กรมธนารักย์) has no daily limit, so every parcel is
 * offered to it before กรมที่ดิน is asked about anything, and the twenty calls
 * a day กรมที่ดิน allows are spent only on the parcels TD could not place.
 *
 * When the day's allowance runs out the run does not spin: the parcels it did
 * not reach stay queued with their priority, and the next run starts with TD
 * again. TD is free, so an exhausted DOL is a pause, not a stop.
 *
 * Environment:
 *   DOL_MAX          how many กรมที่ดิน calls to spend (default 20, the ceiling)
 *   DOL_DELAY_MS     gap between calls (default 1200)
 *   SKIP_TD=1        do not run the TD stage
 */
import { spawnSync } from "child_process";
import pg from "pg";
import { enqueueUnresolved } from "./coordQueue.js";
import { run } from "./resolveCoords.js";
import { createDolLookup } from "./dolLookup.js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();

const log = (m) => console.log(`  ${m}`);

/**
 * The TD stage.
 *
 * Run as a child process rather than imported, because resolveTdParcels.js is a
 * script with its own database connection, its own run bookkeeping and its own
 * province loop - the same reason backfillProvinces.js drives ingest.js as a
 * child. It writes its results to the database, which is the interface between
 * the two halves.
 *
 * DOL_DAILY_LIMIT=0 stops its inline กรมที่ดิน fallback from spending any of the
 * day's allowance: that leg keeps its own counter and does not draw on the
 * ledger, so leaving it enabled would let this stage quietly spend calls the
 * ledger never sees. It is set to zero here on purpose.
 */
function runTdStage() {
  if (process.env.SKIP_TD === "1") {
    log("TD stage skipped (SKIP_TD=1)");
    return { ran: false, code: 0 };
  }
  log("TD stage — no daily limit, asking TD before spending any กรมที่ดิน call");
  const r = spawnSync("bun", ["resolveTdParcels.js", "--write"], {
    stdio: "inherit",
    env: { ...process.env, DOL_DAILY_LIMIT: "0" },
  });
  return { ran: true, code: r.status ?? 1 };
}

try {
  const queued = await enqueueUnresolved(client);
  log(`queue: ${queued.length} parcel(s) eligible`);

  const td = runTdStage();

  /* TD has just placed whatever it could, so the queue is refilled: parcels it
   * resolved now carry coordinates and drop out of scope. What is left is what
   * กรมที่ดิน is the only hope for. */
  const after = await enqueueUnresolved(client);
  log(`after TD: ${after.length} parcel(s) still need a coordinate`);

  const lookup = await createDolLookup({
    delayMs: Number(process.env.DOL_DELAY_MS || 1200),
    log,
  });

  let stats;
  try {
    stats = await run(client, lookup, {
      max: Number(process.env.DOL_MAX || 20),
      delayMs: Number(process.env.DOL_DELAY_MS || 1200),
    });
  } finally {
    await lookup.close();
  }

  console.log("\n=== coordinate run ===");
  for (const [k, v] of Object.entries(stats)) console.log(`  ${k.padEnd(14)} ${v}`);

  /* The allowance is gone. The work is not - it is still queued, still
   * prioritised, and TD is free, so the next run picks it up from the top and
   * starts with TD again. */
  if (stats.stopped === "quota_exhausted") {
    console.log("\n  กรมที่ดิน's allowance is spent. The rest stays queued.");
    console.log("  The next run starts with TD again, which costs nothing.");
  }
  if (td.ran && td.code !== 0) {
    console.log(`\n  the TD stage exited ${td.code} - the DOL stage still ran.`);
  }
} finally {
  await client.end();
}