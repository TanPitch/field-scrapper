/* pricing.test.js — regression tests for the price cascade and ladder.
 *   node pricing.test.js
 */
import assert from "node:assert/strict";
import {
    priceRounds, lotLifecycle, resolveStartPrice, nextRound,
    SELL_STATUS, TERMINAL_CODES, MAX_DISCOUNT_PCT,
} from "./pricing.js";

const mk = (...codes) =>
    codes.map((c, i) => ({ idx: i + 1, date: null, statusCode: String(c), status: null }));

let pass = 0;
const t = (name, fn) => {
    try {
        fn();
        pass++;
        console.log(`  ok   ${name}`);
    } catch (e) {
        console.log(`  FAIL ${name}\n       ${e.message}`);
        process.exitCode = 1;
    }
};

console.log("cascade");
t("committee beats led/officer/expert", () => {
    const s = resolveStartPrice({
        committee_appraisal_price: "9000000", led_appraisal_price: "8000000",
        officer_appraisal_price: "7000000", expert_appraisal_price: "6000000",
    });
    assert.equal(s.start_price, 9000000);
    assert.equal(s.start_price_source, "committee");
});
t("falls through to led", () => {
    const s = resolveStartPrice({
        committee_appraisal_price: "0", led_appraisal_price: "8000000", officer_appraisal_price: "7000000",
    });
    assert.equal(s.start_price, 8000000);
    assert.equal(s.start_price_source, "led");
});
t("falls through to officer", () => {
    const s = resolveStartPrice({
        committee_appraisal_price: "0", led_appraisal_price: "0",
        officer_appraisal_price: "7000000", expert_appraisal_price: "6000000",
    });
    assert.equal(s.start_price, 7000000);
    assert.equal(s.start_price_source, "officer");
});
t("falls through to expert", () => {
    const s = resolveStartPrice({
        committee_appraisal_price: "0", led_appraisal_price: "0",
        officer_appraisal_price: "0", expert_appraisal_price: "6000000",
    });
    assert.equal(s.start_price, 6000000);
    assert.equal(s.start_price_source, "expert");
});
t("all zero -> null", () => {
    assert.equal(resolveStartPrice({
        committee_appraisal_price: "0", led_appraisal_price: "0",
        officer_appraisal_price: "0", expert_appraisal_price: "0",
    }).start_price, null);
});
t("handles commas and decimals", () => {
    assert.equal(resolveStartPrice({ committee_appraisal_price: "1,234.50" }).start_price, 1234.5);
});

console.log("ladder");
t("งดขาย does not deepen; round after no-bid is -10%", () => {
    // confirmed example: งดขาย, งดขาย, งดขายไม่มีผู้สู้ราคา, งดขาย -> round 5 is -10%
    const r = priceRounds(mk(13, 13, 3, 13, 0, 0), 100000);
    assert.equal(r[0].discount_pct, 0);
    assert.equal(r[1].discount_pct, 0);
    assert.equal(r[2].discount_pct, 0); // a no-bid round is itself undiscounted
    assert.equal(r[3].discount_pct, 10);
    assert.equal(r[3].price, 90000);
    assert.equal(r[4].discount_pct, 10);
    assert.equal(r[4].price, 90000);
});
t("caps at -30%", () => {
    const r = priceRounds(mk(3, 3, 3, 3, 3, 3), 100000);
    assert.deepEqual(r.map((x) => x.discount_pct), [0, 10, 20, 30, 30, 30]);
    assert.equal(r[3].price, 70000);
    assert.equal(MAX_DISCOUNT_PCT, 30);
});
t("unheld round carries the last known price", () => {
    const r = priceRounds(mk(3, 0, 0), 100000);
    assert.equal(r[1].price, 90000);
    assert.equal(r[2].price, 90000);
});
t("no start price -> no prices", () => {
    const r = priceRounds(mk(3, 3), null);
    assert.equal(r[0].price, null);
    assert.equal(r[1].price, null);
});
t("round count is not hardcoded to 6", () => {
    const eight = Array.from({ length: 8 }, (_, i) => (i + 1).toString());
    const r = priceRounds(mk(...eight), 100000);
    assert.equal(r.length, 8);
});

console.log("lifecycle");
t("1 / 6 / 26 close the lot", () => {
    for (const [code, reason] of [[1, "sold"], [6, "withdrawn"], [26, "cancelled_remaining_rounds"]]) {
        const l = lotLifecycle(priceRounds(mk(code, 0, 0), 100000));
        assert.equal(l.status, "closed", `code ${code}`);
        assert.equal(l.close_reason, reason);
    }
});
t("3 / 7 / 10 / 13 / 23 / 0 stay active", () => {
    for (const code of [3, 7, 10, 13, 23, 0]) {
        assert.equal(lotLifecycle(priceRounds(mk(code, 0, 0), 100000)).status, "active", `code ${code}`);
    }
});
t("terminal set is exactly 1,6,26", () => {
    assert.deepEqual([...TERMINAL_CODES].sort((a, b) => a - b), [1, 6, 26]);
});
t("a later terminal code still closes", () => {
    assert.equal(lotLifecycle(priceRounds(mk(13, 13, 26, 0), 100000)).close_reason, "cancelled_remaining_rounds");
});

console.log("status labels");
t("all observed codes are labelled", () => {
    for (const code of [0, 1, 3, 6, 7, 10, 13, 23, 26]) {
        assert.ok(code in SELL_STATUS, `code ${code} unlabelled`);
    }
    assert.equal(SELL_STATUS[3], "งดขายไม่มีผู้สู้ราคา");
});

console.log("next round");
t("nextRound picks the nearest future round", () => {
    const rounds = priceRounds(
        [{ idx: 1, date: "2026-07-13", statusCode: "3", status: null },
         { idx: 2, date: "2026-08-03", statusCode: "0", status: null },
         { idx: 3, date: "2026-08-24", statusCode: "0", status: null }],
        100000,
    );
    const n = nextRound(rounds, "2026-07-20");
    assert.equal(n.idx, 2);
    assert.equal(n.date, "2026-08-03");
    assert.equal(n.price, 90000);
});
t("skips past-dated 0 slots (lapsed rounds)", () => {
    // rounds 1-3 already lapsed, round 4 is still ahead
    const rounds = priceRounds(
        [{ idx: 1, date: "2026-06-08", statusCode: "0", status: null },
         { idx: 2, date: "2026-06-29", statusCode: "0", status: null },
         { idx: 3, date: "2026-07-20", statusCode: "0", status: null },
         { idx: 4, date: "2026-10-21", statusCode: "0", status: null }],
        715040,
    );
    const n = nextRound(rounds, "2026-10-01");
    assert.equal(n.idx, 4, "must not fall back to round 1");
});
t("nextRound is null once every slot is held", () => {
    assert.equal(nextRound(priceRounds(mk(1, 1), 100000), "2030-01-01"), null);
});
t("nextRound is null when there are no rounds at all", () => {
    assert.equal(nextRound([], "2030-01-01"), null);
});
t("code 0 has a readable label", () => {
    const r = priceRounds(mk(0), 100000);
    assert.ok(r[0].status_label && !r[0].status_label.startsWith("?"), `got ${r[0].status_label}`);
});

console.log(`\n${pass} passed${process.exitCode ? ", some FAILED" : ", all green"}`);