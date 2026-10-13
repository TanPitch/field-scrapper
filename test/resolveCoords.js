/* resolveCoords.js — the daily worker that turns LED parcels into map points.
 *
 * กรมที่ดิน's anonymous tier allows 20 lookups/day. This worker spends exactly
 * that, no more, in the order that matters most:
 *
 *   1. only parcels with no coordinates yet are queued
 *   2. soonest upcoming auction round first
 *   3. one quota unit is spent BEFORE each request, so a crash mid-run cannot
 *      under-count and cause an over-quota day later
 *   4. a returned "เกินจำกัด 20/วัน" stops the run cleanly rather than retrying
 *
 * The DOL lookup is injected. That is deliberate: it lets the quota, ordering
 * and verification logic be tested exhaustively without spending real quota,
 * and it keeps the transport (Puppeteer token, rate limiting) swappable.
 *
 *   DATABASE_URL=... node resolveCoords.js
 */
import pg from "pg";
import {
    startRun, finishRun, claim, resolve, fail, getQuota,
    isQuotaExhausted,
} from "./coordQueue.js";
import { ProvenanceRecorder, SOURCE, raiNganWaToSqWa, compareArea } from "./provenance.js";

const { Client } = pg;

/**
 * Decide what to do with one parcel's DOL answer.
 * Pure, so the verification rule can be tested without the database.
 *
 * A non-empty response is NOT proof of identity. NOTES §17 measured 5 of 30
 * same-number hits resolving to a different property, concentrated in condo
 * and น.ส.3ก. rows, so area agreement is required before `verified`.
 */
export function classify(parcel, dol) {
    if (!dol || dol.found !== true) {
        return { state: "skip", geoStatus: "unresolved", note: dol?.reason ?? "not found" };
    }
    if (parcel.land_title === "น.ส.3ก." || parcel.asset_type === "condo") {
        return {
            state: "skip",
            geoStatus: "mismatch",
            note: "condo / น.ส.3ก. unit number is not a land parcel number",
        };
    }

    const ledSqWa = parcel.size_unit === "sqm"
        ? null                                   // ตร.ม. — never comparable
        : raiNganWaToSqWa(parcel.size_rai, parcel.size_ngan, parcel.size_wa);
    const dolSqWa = dol.areaSqWa ?? null;
    const verdict = compareArea(ledSqWa, dolSqWa);

    if (verdict === "mismatch") {
        return {
            state: "resolve", geoStatus: "mismatch",
            note: `area differs: LED ${ledSqWa} ตร.ว. vs กรมที่ดิน ${dolSqWa} ตร.ว.`,
        };
    }
    return {
        state: "resolve", geoStatus: "verified",
        note: verdict === "unknown" ? "area not comparable; coordinates stored unverified" : null,
    };
}

/**
 * @param {import('pg').Client} client
 * @param {(parcel:object)=>Promise<object>} lookup  injected DOL transport
 * @param {{max?:number, delayMs?:number}} opts
 */
export async function run(client, lookup, { max = 20, delayMs = 1500 } = {}) {
    const prov = new ProvenanceRecorder(client);
    const stats = {
        attempted: 0, resolved: 0, mismatched: 0, failed: 0, skipped: 0,
        stopped: null, quotaDate: null, quotaUsed: null, quotaLimit: null,
    };

    const runId = await startRun(client);
    const { claimed, stopped } = await claim(client, { max });
    stats.stopped = stopped ?? null;

    const quota = await getQuota(client);
    stats.quotaDate = quota.quota_date;
    stats.quotaUsed = quota.used;
    stats.quotaLimit = quota.limit_value;

    for (const parcel of claimed) {
        // Quota was already reserved by claim(), so there is nothing to spend
        // here. Reserving at claim time means a crash mid-run under-uses the
        // day rather than silently over-using it later.

        let dol;
        try {
            dol = await lookup(parcel);
        } catch (err) {
            await fail(client, parcel.parcel_id, err, { maxAttempts: 5 });
            stats.failed++;
            continue;
        }
        stats.attempted++;

        if (isQuotaExhausted(dol?.status)) {
            // The service told us the day's quota is gone. Stop immediately and
            // release this claim so it is retried tomorrow, not burned.
            await fail(client, parcel.parcel_id, "quota exhausted", { maxAttempts: 99 });
            stats.stopped = "quota_exhausted";
            break;
        }

        const verdict = classify(parcel, dol);
        if (verdict.state === "resolve") {
            await resolve(client, parcel.parcel_id, dol, {
                geoStatus: verdict.geoStatus,
                note: verdict.note,
            });
            prov.recordFields("parcel", parcel.parcel_id, {
                dol_lat: dol.lat,
                dol_lon: dol.lon,
                dol_land_price: dol.landPrice,
                dol_rai: dol.rai,
                dol_ngan: dol.ngan,
                dol_wa: dol.wa,
                dol_land_type: dol.landType,
                dol_office: dol.office,
            });
            if (verdict.geoStatus === "verified") stats.resolved++;
            else stats.mismatched++;
        } else {
            await fail(client, parcel.parcel_id, verdict.note, { maxAttempts: 99 });
            stats.skipped++;
        }

        if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    }

    await prov.flush();
    await prov.touchSources([SOURCE.DOL]);
    await finishRun(client, runId, stats);
    return stats;
}

// ---- CLI ------------------------------------------------------------------

if (import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1]).href) {
    const url = process.env.DATABASE_URL;
    if (!url) {
        console.error("DATABASE_URL is required");
        process.exit(1);
    }
    const client = new Client({ connectionString: url });
    await client.connect();

    /* Default transport is intentionally NOT wired here. The live lookup needs
       the LandsMaps bearer token and Puppeteer session handling that
       scrapeLand.js owns; wire it in once that path is refactored behind a
       single function. Until then this fails loudly rather than pretending. */
    const lookup = async () => {
        throw new Error(
            "no DOL transport configured: pass a lookup(parcel) function to run()",
        );
    };

    try {
        const stats = await run(client, lookup, {
            max: Number(process.env.DOL_MAX || 20),
            delayMs: Number(process.env.DOL_DELAY_MS || 1500),
        });
        console.log(stats);
    } finally {
        await client.end();
    }
}
