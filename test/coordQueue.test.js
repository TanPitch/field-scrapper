/* Tests for the quota/priority decision logic. These rules decide whether we
 * ever exceed a public agency's 20/day limit, so they are tested as pure
 * functions rather than only through the database. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
    computePriority,
    pickNextRound,
    quotaRemaining,
    backoffMs,
    isQuotaExhausted,
} from "./coordQueue.js";
import { compareArea, raiNganWaToSqWa } from "./provenance.js";

const TODAY = new Date("2026-10-12T09:00:00Z");

/* ------------------------------------------------------------- priority */

test("computePriority returns days until the round", () => {
    assert.equal(computePriority("2026-10-12", TODAY), 0);
    assert.equal(computePriority("2026-10-13", TODAY), 1);
    assert.equal(computePriority("2026-10-26", TODAY), 14);
});

test("computePriority returns a negative value for a past round", () => {
    assert.equal(computePriority("2026-10-01", TODAY), -11);
});

test("computePriority uses a sentinel when nothing is scheduled", () => {
    assert.equal(computePriority(null, TODAY), 9999);
    assert.equal(computePriority("", TODAY), 9999);
    assert.equal(computePriority("not-a-date", TODAY), 9999);
});

test("computePriority is not confused by a time component", () => {
    assert.equal(computePriority("2026-10-13T23:30:00Z", TODAY), 1);
});

/* ------------------------------------------------------------ next round */

test("pickNextRound takes the soonest upcoming round", () => {
    assert.equal(
        pickNextRound(["2026-11-01", "2026-10-20", "2026-10-15"], { today: TODAY }),
        "2026-10-15",
    );
});

test("pickNextRound includes today's round", () => {
    assert.equal(pickNextRound(["2026-10-12", "2026-10-20"], { today: TODAY }), "2026-10-12");
});

test("pickNextRound ignores rounds that have already passed", () => {
    assert.equal(pickNextRound(["2026-10-01", "2026-10-05"], { today: TODAY }), null);
});

test("pickNextRound ignores malformed dates", () => {
    assert.equal(pickNextRound(["garbage", "2026-10-20"], { today: TODAY }), "2026-10-20");
    assert.equal(pickNextRound(["garbage"], { today: TODAY }), null);
    assert.equal(pickNextRound([], { today: TODAY }), null);
});

/* ---------------------------------------------------------------- quota */

test("quotaRemaining counts down correctly", () => {
    assert.equal(quotaRemaining({ used: 0, limit: 20 }), 20);
    assert.equal(quotaRemaining({ used: 19, limit: 20 }), 1);
    assert.equal(quotaRemaining({ used: 20, limit: 20 }), 0);
});

test("quotaRemaining never returns a negative number", () => {
    // Defensive: an over-quota ledger must still produce a safe claim size of
    // zero rather than a negative LIMIT.
    assert.equal(quotaRemaining({ used: 25, limit: 20 }), 0);
});

test("quotaRemaining treats missing values as zero", () => {
    assert.equal(quotaRemaining({}), 0);
    assert.equal(quotaRemaining(null), 0);
});

test("isQuotaExhausted recognises both spellings", () => {
    assert.equal(isQuotaExhausted("quota_exhausted"), true);
    assert.equal(isQuotaExhausted("limit"), true);
    assert.equal(isQuotaExhausted("ok"), false);
    assert.equal(isQuotaExhausted(undefined), false);
});

/* --------------------------------------------------------------- backoff */

test("backoffMs grows exponentially and is capped", () => {
    assert.equal(backoffMs(1), 60_000);
    assert.equal(backoffMs(2), 120_000);
    assert.equal(backoffMs(3), 240_000);
    assert.equal(backoffMs(50), 6 * 3_600_000); // capped
});

test("backoffMs treats 0 or missing attempts as the first try", () => {
    assert.equal(backoffMs(0), 60_000);
    assert.equal(backoffMs(undefined), 60_000);
    assert.equal(backoffMs(null), 60_000);
});

/* ----------------------------------------------------------------- area */

test("raiNganWaToSqWa converts to square wa", () => {
    assert.equal(raiNganWaToSqWa(2, 1, 64), 2 * 400 + 100 + 64); // 964
    assert.equal(raiNganWaToSqWa(0, 0, 50), 50);
    assert.equal(raiNganWaToSqWa(1, 0, 0), 400);
});

test("raiNganWaToSqWa returns null for an all-zero size", () => {
    assert.equal(raiNganWaToSqWa(0, 0, 0), null);
    assert.equal(raiNganWaToSqWa(null, null, null), null);
    assert.equal(raiNganWaToSqWa("", "", ""), null);
});

test("compareArea accepts a match within tolerance", () => {
    assert.equal(compareArea(964, 964), "match");
    assert.equal(compareArea(1000, 1020), "match");   // 2%
    assert.equal(compareArea(100, 99), "match");
});

test("compareArea flags a real mismatch", () => {
    // This is the §17 case: same deed number, different property.
    assert.equal(compareArea(964, 1600), "mismatch");
    assert.equal(compareArea(400, 40), "mismatch");
});

test("compareArea returns unknown when either side is missing", () => {
    assert.equal(compareArea(null, 964), "unknown");
    assert.equal(compareArea(964, null), "unknown");
    assert.equal(compareArea(0, 0), "unknown");
    assert.equal(compareArea(-5, 100), "unknown");
});

test("compareArea honours a custom tolerance", () => {
    assert.equal(compareArea(1000, 1100), "mismatch");
    assert.equal(compareArea(1000, 1100, { tolerancePct: 15 }), "match");
});
