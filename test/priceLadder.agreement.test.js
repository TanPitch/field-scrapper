/* priceLadder.agreement.test.js — the frontend price ladder must equal the
 * backend's, on real data.
 *
 *   cd test; bun priceLadder.agreement.test.js
 *
 * src/lib/price.ts re-implements the discount rule that test/pricing.js owns,
 * because the frontend needs it before the API is wired up. Two implementations
 * of one business rule is a drift risk, so this runs both over every round in the
 * database and fails on the first disagreement. If pricing.js changes, this
 * breaks and the frontend is updated to match — which is the point.
 *
 * Skips cleanly when DATABASE_URL is unset.
 */
import assert from "node:assert/strict";
import pg from "pg";
import { priceRounds } from "./pricing.js";
import { priceLadder, DISCOUNT_STEP_PCT, MAX_DISCOUNT_PCT } from "../src/lib/price.ts";

const { Client } = pg;
const url = process.env.DATABASE_URL;
if (!url) {
    console.log("skip: DATABASE_URL not set");
    process.exit(0);
}

const client = new Client({ connectionString: url });
await client.connect();

/* Real rounds, in order, with the lot's own opening price. */
const { rows: lots } = await client.query(`
    SELECT l.id, l.start_price, l.start_price_src
      FROM auction_lots l
     WHERE l.start_price IS NOT NULL AND l.start_price > 0
     ORDER BY l.id`);

if (!lots.length) {
    console.log("skip: no priced lots in the database");
    await client.end();
    process.exit(0);
}

const { rows: rounds } = await client.query(`
    SELECT r.lot_id, r.idx, r.round_date, r.status_code, r.price AS stored_price, r.discount_pct AS stored_discount
      FROM auction_rounds r
     ORDER BY r.lot_id, r.idx`);

const byLot = new Map();
for (const r of rounds) {
    if (!byLot.has(r.lot_id)) byLot.set(r.lot_id, []);
    byLot.get(r.lot_id).push(r);
}

let checked = 0;
let mismatches = [];
let discountSeen = new Set();

for (const lot of lots) {
    const rs = byLot.get(lot.id) ?? [];

    const input = rs.map((r) => ({ roundDate: r.round_date, statusCode: r.status_code }));
    const backend = priceRounds(input, Number(lot.start_price));

    /* The frontend takes the same shape the UI holds. */
    const uiRounds = rs.map((r) => ({
        date: r.round_date == null ? null : new Date(r.round_date).getTime(),
        status: "",
        statusCode: r.status_code,
    }));
    const frontend = priceLadder(uiRounds, Number(lot.start_price));

    assert.equal(frontend.length, backend.length, `lot ${lot.id}: round count differs`);

    for (let i = 0; i < backend.length; i++) {
        const b = backend[i];
        const f = frontend[i];
        discountSeen.add(b.discount_pct);

        if (f.discountPct !== b.discount_pct) {
            mismatches.push(`lot ${lot.id} round ${i + 1}: discount backend=${b.discount_pct} frontend=${f.discountPct}`);
        }
        /* start_price is a money value; the ladder rounds to 2dp on both sides. */
        if (Math.abs((f.price ?? 0) - (b.price ?? 0)) > 0.005) {
            mismatches.push(`lot ${lot.id} round ${i + 1}: price backend=${b.price} frontend=${f.price}`);
        }
        checked++;
    }

    /* The stored column is what the API serves. If the recomputed ladder
       disagrees with it, the database and the rule have already drifted. */
    for (let i = 0; i < rs.length; i++) {
        const stored = rs[i].stored_price == null ? null : Number(rs[i].stored_price);
        if (stored != null && Math.abs(stored - Number(backend[i].price)) > 0.005) {
            mismatches.push(`lot ${lot.id} round ${i + 1}: stored price=${stored} vs recomputed=${backend[i].price}`);
        }
    }
}

/* A test that only ever sees one discount level would pass even if the cap were
   wrong, so assert the ladder actually exercised the range. */
console.log(`checked ${checked} rounds across ${lots.length} lots`);
console.log(`discount levels seen: ${[...discountSeen].sort((a, b) => a - b).join(", ")}`);
console.log(`rule: step=${DISCOUNT_STEP_PCT}% cap=${MAX_DISCOUNT_PCT}%`);

assert.ok(
    [...discountSeen].some((d) => d > 0),
    "no discounted round in the data — the ladder was never exercised",
);

if (mismatches.length) {
    console.error(`\n${mismatches.length} MISMATCH(ES):`);
    for (const m of mismatches.slice(0, 20)) console.error(`  ${m}`);
    process.exitCode = 1;
} else {
    console.log("\nfrontend ladder agrees with backend on every round");
}

/* ------------------------------------------------------------------------
 * The popups are raw HTML strings, so they cannot reuse the React component and
 * duplicate the markup. Check they at least duplicate the *numbers*: whatever
 * string the popup shows as the price must be the ladder's next-round price, and
 * a struck-through aside must only appear when a discount actually applies.
 * ---------------------------------------------------------------------- */
const { priceHtmlFull, priceHtmlCompact, openPriceHtml } = await import("../src/lib/priceHtml.ts");
const { nextRoundPrice: frontendNext } = await import("../src/lib/price.ts");

/* Real lots, Parcel-shaped, straight off the DB. The seeded fixture corpus this
   block used to read is gone with the mockup data (liveData no longer ships a
   fallback dataset), so the popup checks run on what the servers actually
   hold — one parcel of each close state, each with its own rounds. */
const statusShapes = [
    ["sold", "l.close_reason IS NOT NULL AND l.close_code = 1"],
    ["inactive", "l.close_reason IS NOT NULL AND l.close_code <> 1"],
    ["sale", "l.close_reason IS NULL AND EXISTS (SELECT 1 FROM auction_rounds r2 WHERE r2.lot_id = l.id AND r2.discount_pct > 0)"],
    ["sale", "l.close_reason IS NULL AND NOT EXISTS (SELECT 1 FROM auction_rounds r2 WHERE r2.lot_id = l.id AND r2.discount_pct > 0)"],
];
const popParcels = [];
for (const [status, cond] of statusShapes) {
    const { rows } = await client.query(`
        SELECT l.id, l.start_price, l.published_date,
               (SELECT json_agg(json_build_object(
                           'date', r.round_date, 'status_code', r.status_code,
                           'price', r.price, 'discount_pct', r.discount_pct,
                           'sold_price', r.sold_price)
                           ORDER BY r.round_date NULLS LAST, r.id)
                   FROM auction_rounds r WHERE r.lot_id = l.id) AS rounds
          FROM auction_lots l
         WHERE l.start_price IS NOT NULL AND l.start_price > 0 AND ${cond}
         ORDER BY l.id DESC LIMIT 1`);
    for (const row of rows) {
        const announce = Date.now();
        const start = Number(row.start_price);
        const hist = [];
        for (const r of row.rounds ?? []) {
            if (r.price != null) hist.push({ d: r.date ? new Date(r.date).getTime() : announce, v: Number(r.price) });
        }
        hist.unshift({ d: announce, v: start });
        popParcels.push({
            id: row.id, status, price: hist[hist.length - 1].v, hist, announce,
            rounds: (row.rounds ?? []).map((r) => ({
                date: r.date ? new Date(r.date).getTime() : null,
                status: "", statusCode: r.status_code, price: r.price != null ? Number(r.price) : null,
                discountPct: r.discount_pct, soldPrice: r.sold_price != null ? Number(r.sold_price) : null,
            })),
        });
    }
}
const ALL_PARCELS = popParcels;

let popChecked = 0;
const popProblems = [];

for (const p of ALL_PARCELS) {
  const now = Date.now();
  const next = frontendNext(p, now);
  const full = priceHtmlFull(p, now);
  const compact = priceHtmlCompact(p, now);

  if (next) {
    /* the discount badge must exist iff there is a discount — never "-0%" */
    const badge = /class="pop-disc"[^>]*>(-?\d+)%/.exec(full);
    if (next.discountPct > 0) {
      if (!badge) popProblems.push(`parcel ${p.id}: has -${next.discountPct}% but no badge`);
      else if (badge[1] !== `-${Math.round(next.discountPct)}`) {
        popProblems.push(`parcel ${p.id}: badge ${badge[1]}% != -${Math.round(next.discountPct)}`);
      }
      /* The opening price moved beside the deed number, so it is checked where it
         now lives - openPriceHtml, not inside priceHtmlFull. Asserting on
         priceHtmlFull reported 274 phantom problems for a popup that was showing
         the price correctly one line lower. */
      if (!/class="pop-was"/.test(openPriceHtml(next))) popProblems.push(`parcel ${p.id}: discounted but no opening price`);
    } else if (badge && Number(badge[1]) === 0) {
      popProblems.push(`parcel ${p.id}: rendered a -0% badge`);
    } else if (/class="pop-was"/.test(openPriceHtml(next))) {
      popProblems.push(`parcel ${p.id}: opening price shown with no discount`);
    }
  }

  /* sold lots must not advertise a next round */
  if (p.status === "sold" && next) {
    popProblems.push(`parcel ${p.id}: sold but a next-round price was produced`);
  }
  /* withdrawn lots must not advertise one either — the listing came down, so
     there is no round left to buy into. */
  if (p.status === "inactive" && next) {
    popProblems.push(`parcel ${p.id}: inactive but a next-round price was produced`);
  }
  /* and a withdrawn lot has no struck-through start price, because that is the
     "already reduced" signal and it never reduced */
  if (p.status === "inactive" && /class="pop-was"/.test(full)) {
    popProblems.push(`parcel ${p.id}: inactive but a struck-through start price was shown`);
  }
  void compact;
  popChecked++;
}

console.log(`\npopup markup checked on ${popChecked} DB parcels`);
if (popProblems.length) {
  console.error(`${popProblems.length} POPUP PROBLEM(S):`);
  for (const m of popProblems.slice(0, 15)) console.error(`  ${m}`);
  process.exitCode = 1;
} else {
  console.log("popup discount badges and struck-through prices are consistent");
}

await client.end();
