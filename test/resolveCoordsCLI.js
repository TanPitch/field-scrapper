/* resolveCoordsCLI.js — run the coordinate queue against the live กรมที่ดิน
 * service, spending only the quota the ledger allows.
 *
 *   DATABASE_URL=postgres://... bun resolveCoordsCLI.js
 *
 * Safe to run daily. It claims at most the day's remaining allowance, resolves
 * in urgency order, and stops the moment the service signals the limit.
 */
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

try {
    const queued = await enqueueUnresolved(client);
    log(`queue: ${queued.length} parcel(s) eligible`);

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
} finally {
    await client.end();
}
