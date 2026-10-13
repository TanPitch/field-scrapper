/* scheduler.test.js — the window and the per-province next-round rule.
 *   node scheduler.test.js
 */
import assert from "node:assert/strict";
import { plan, nextRoundByProvince, isWithinWindow, ictNow, WINDOW_START_HOUR } from "./scheduler.js";

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

const lot = (city, rounds, lifecycle = { status: "active" }) => ({
    address: { city, deeds: { numbers: ["1"] } },
    bid: { rounds: rounds.map((d, i) => ({ idx: i + 1, date: d })) },
    lifecycle,
});
/* Build an instant from ICT wall-clock time: "2026-10-12T18:00" ICT.
   Node needs an explicit seconds field, so pad it in. */
const d = (s) => new Date(`${s}:00+07:00`);

console.log("ICT clock");
t("converts UTC to ICT (+7)", () => {
    assert.equal(ictNow(d("2026-10-12T15:00")).date, "2026-10-12");
    assert.equal(ictNow(d("2026-10-12T15:00")).hour, 15);
});
t("crosses midnight correctly", () => {
    assert.equal(ictNow(d("2026-10-13T01:30")).date, "2026-10-13");
    assert.equal(ictNow(d("2026-10-13T01:30")).hour, 1);
});
t("weekday is correct", () => {
    assert.equal(ictNow(d("2026-10-12T13:00")).weekday, 1); // Mon
    assert.equal(ictNow(d("2026-10-11T13:00")).weekday, 0); // Sun
});

console.log("window");
t("inside window: Mon 18:00 ICT", () => assert.equal(isWithinWindow(d("2026-10-12T18:00")), true));
t("before window: Mon 16:00 ICT", () => assert.equal(isWithinWindow(d("2026-10-12T16:00")), false));
t("after window: Mon 23:59 ICT", () => assert.equal(isWithinWindow(d("2026-10-12T23:59")), true));
t("midnight excluded", () => assert.equal(isWithinWindow(d("2026-10-13T00:00")), false));
t("Saturday excluded", () => assert.equal(isWithinWindow(d("2026-10-10T18:00")), false));
t("Sunday excluded", () => assert.equal(isWithinWindow(d("2026-10-11T18:00")), false));

console.log("next round per province");
t("picks the nearest upcoming date", () => {
    const lots = [lot("A", ["2026-10-20", "2026-11-03"]), lot("B", ["2026-10-15", "2026-12-01"])];
    const s = nextRoundByProvince(lots, "2026-10-12");
    assert.equal(s.find((x) => x.province === "A").date, "2026-10-20");
    assert.equal(s.find((x) => x.province === "B").date, "2026-10-15");
});
t("ignores past dates", () => {
    const s = nextRoundByProvince([lot("A", ["2026-10-01", "2026-10-20"])], "2026-10-12");
    assert.equal(s[0].date, "2026-10-20");
});
t("counts a round happening today as upcoming", () => {
    // tonight's 17:00-24:00 window is exactly when we must scrape it
    const s = nextRoundByProvince([lot("A", ["2026-10-12", "2026-11-01"])], "2026-10-12");
    assert.equal(s[0].date, "2026-10-12", "today's round must still be scheduled");
});
t("ignores closed lots", () => {
    const s = nextRoundByProvince(
        [lot("A", ["2026-10-20"], { status: "closed", close_reason: "sold" })],
        "2026-10-12",
    );
    assert.equal(s.length, 0, "a sold lot must not be scheduled again");
});
t("takes the earliest across a province's lots", () => {
    const s = nextRoundByProvince(
        [lot("A", ["2026-11-30"]), lot("A", ["2026-10-14"]), lot("A", ["2026-12-20"])],
        "2026-10-12",
    );
    assert.equal(s.length, 1);
    assert.equal(s[0].date, "2026-10-14");
});
t("counts distinct deeds", () => {
    const a = { address: { city: "A", deeds: { numbers: ["1", "2"] } }, bid: { rounds: [{ idx: 1, date: "2026-10-20" }] }, lifecycle: { status: "active" } };
    const b = { address: { city: "A", deeds: { numbers: ["2"] } }, bid: { rounds: [{ idx: 1, date: "2026-10-20" }] }, lifecycle: { status: "active" } };
    const s = nextRoundByProvince([a, b], "2026-10-12");
    assert.equal(s[0].deeds, 2);
});

console.log("plan");
t("province due tonight is queued when in window", () => {
    const lots = [lot("A", ["2026-10-12", "2026-11-01"])];
    const p = plan(lots, { now: d("2026-10-12T18:00") }); // Mon 18:00 ICT
    assert.equal(p.in_window, true);
    assert.equal(p.due_now.length, 1);
    assert.equal(p.due_now[0].province, "A");
});
t("nothing runnable outside the window, but the province stays visible", () => {
    const lots = [lot("A", ["2026-10-12"])];
    const p = plan(lots, { now: d("2026-10-12T16:00") }); // Mon 16:00 ICT
    assert.equal(p.due_now.length, 0, "must not run before 17:00");
    assert.equal(p.due_today.length, 1, "but must not be dropped either");
    assert.ok(p.skip_reason.includes("outside"));
});
t("weekend skips even when a round is due", () => {
    const lots = [lot("A", ["2026-10-11"])]; // Sunday
    const p = plan(lots, { now: d("2026-10-11T18:00") });
    assert.equal(p.due_now.length, 0);
    assert.equal(p.skip_reason, "outside Mo-Fr");
});
t("already scraped tonight is not re-queued", () => {
    const lots = [lot("A", ["2026-10-12"])];
    const p = plan(lots, { now: d("2026-10-12T18:00"), scrapedTonight: new Set(["A"]) });
    assert.equal(p.due_now.length, 0);
    assert.equal(p.due_today.length, 1, "still tracked, just not re-run");
});
t("a past round date surfaces as overdue", () => {
    const p = plan([lot("A", ["2026-10-05"])], { now: d("2026-10-12T18:00") });
    assert.equal(p.overdue.length, 1);
    assert.equal(p.overdue[0].date, "2026-10-05");
});

console.log(`\n${pass} passed${process.exitCode ? ", some FAILED" : ", all green"}`);