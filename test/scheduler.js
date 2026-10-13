/* scheduler.js — decide when each province must be re-scraped.
 *
 * Per the user's rule: for each province take the NEAREST upcoming round date
 * across its active lots, and re-scrape that province on that date during
 * 17:00-24:00 ICT (UTC+7), Monday-Friday.
 *
 * Nothing here predicts prices or outcomes. It only answers "when should we
 * look again", which is fully determined by round dates LED already published.
 *
 *   node scheduler.js [rowsFile] [--now ISO] [--tz +07:00]
 */

/* Bangkok is UTC+7 with no DST. A fixed offset is correct here and avoids
   pulling in a tz database for a zone that has never observed DST. */
export const ICT_OFFSET_MIN = 7 * 60;

/** Parse "YYYY-MM-DD" as a calendar date (no timezone attached). */
const asDate = (s) => new Date(`${s}T00:00:00Z`);
const ymd = (d) => d.toISOString().slice(0, 10);

/** ICT wall-clock fields for an instant. */
export function ictNow(now = new Date()) {
    const shifted = new Date(now.getTime() + ICT_OFFSET_MIN * 60_000);
    return {
        date: shifted.toISOString().slice(0, 10),
        hour: shifted.getUTCHours(),
        minute: shifted.getUTCMinutes(),
        weekday: shifted.getUTCDay(), // 0=Sun .. 6=Sat
    };
}

export const WINDOW_START_HOUR = 17;
export const WINDOW_END_HOUR = 24; // exclusive; 24 = midnight
export const WORKING_WEEKDAYS = new Set([1, 2, 3, 4, 5]); // Mon-Fri

export function isWithinWindow(now = new Date()) {
    const { hour, weekday } = ictNow(now);
    return WORKING_WEEKDAYS.has(weekday) && hour >= WINDOW_START_HOUR && hour < WINDOW_END_HOUR;
}

/**
 * Nearest round date still ahead, per province.
 *
 * `today` itself IS upcoming: a round scheduled for tonight has not been
 * scraped yet, and tonight's window (17:00-24:00) is precisely when we need to
 * see it. So the comparison is `>= today`, not `> today`.
 *
 * Only ACTIVE lots count. A lot closed by code 1 / 6 / 26 will never hold
 * another round, so scheduling it would be wasted work forever.
 */
export function nextRoundByProvince(lots = [], today = ictNow().date) {
    const t = asDate(today);
    const per = new Map();

    for (const lot of lots) {
        if (lot.lifecycle?.status && lot.lifecycle.status !== "active") continue;

        const all = (lot.bid?.rounds ?? []).filter((r) => r.date).map((r) => r.date).sort();
        if (!all.length) continue;

        const province = lot.address?.city ?? null;
        if (!province) continue;

        let e = per.get(province);
        if (!e) {
            e = { province, next: null, newest: null, lots: 0, deeds: new Set() };
            per.set(province, e);
        }
        e.lots++;
        for (const d of lot.address?.deeds?.numbers ?? []) e.deeds.add(d);

        /* Two different questions, kept apart:
             next   = soonest date not yet gone  -> when must we scrape
             newest = latest date seen            -> has anything been missed
           Tracking the newest alone (an earlier attempt) made every province
           look overdue and hid the round that actually needs scraping. */
        const upcoming = all.filter((x) => asDate(x) >= t);
        if (upcoming.length) {
            const soonest = upcoming[0];
            if (e.next === null || soonest < e.next) e.next = soonest;
        }
        const newest = all[all.length - 1];
        if (e.newest === null || newest > e.newest) e.newest = newest;
    }

    return [...per.values()]
        .map((e) => ({
            province: e.province,
            date: e.next ?? e.newest,   // due date; falls back to the newest seen
            next: e.next,
            newest: e.newest,
            overdue: e.next === null,   // nothing left to wait for
            lots: e.lots,
            deeds: e.deeds.size,
        }))
        .sort((a, b) => a.date.localeCompare(b.date) || a.province.localeCompare(b.province));
}

/**
 * What should the scheduler do right now.
 *
 * Returns one entry per province that is (a) due tonight and (b) not already
 * scraped tonight — the caller persists the run so a crash cannot double-scrape.
 */
export function plan(lots = [], { now = new Date(), scrapedTonight = new Set() } = {}) {
    const ict = ictNow(now);
    const schedule = nextRoundByProvince(lots, ict.date);
    const inWindow = isWithinWindow(now);

    /* A province is "due" when its nearest round is today. Whether we can act
       right now depends on the window and on whether tonight's run already
       happened — but a due province must stay visible either way, otherwise a
       missed window silently drops the scrape. */
    const dueToday = schedule.filter((s) => s.next === ict.date);
    const runnable = dueToday.filter((s) =>
        inWindow &&
        WORKING_WEEKDAYS.has(ict.weekday) &&
        !scrapedTonight.has(s.province),
    );

    return {
        now_ict: `${ict.date} ${String(ict.hour).padStart(2, "0")}:${String(ict.minute).padStart(2, "0")}`,
        weekday: ict.weekday,
        in_window: inWindow,
        due_today: dueToday,
        due_now: runnable,
        upcoming: schedule.filter((s) => s.next && s.next > ict.date),
        overdue: schedule.filter((s) => s.overdue),
        skip_reason: inWindow ? null
            : !WORKING_WEEKDAYS.has(ict.weekday) ? "outside Mo-Fr"
            : `outside ${WINDOW_START_HOUR}:00-${WINDOW_END_HOUR}:00 ICT`,
    };
}

// ---- CLI ------------------------------------------------------------------

/* pathToFileURL, not a hand-built `file://${argv[1]}` — on Windows that yields
   `file://C:/...` while import.meta.url is `file:///C:/...`, so the CLI block
   silently never ran. */
if (import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1]).href) {
    const fs = await import("fs");
    const { priceRow } = await import("./pricing.js");

    const args = process.argv.slice(2);
    /* Positional file = the first arg that is not a flag AND not a flag's value.
       A naive `find(a => !a.startsWith("--"))` also picks up `--now`'s value. */
    const nowIdx = args.indexOf("--now");
    const skip = new Set([nowIdx, nowIdx + 1]);
    const file = args.find((a, i) => !a.startsWith("--") && !skip.has(i)) ?? "./out/rows.json";
    const now = nowIdx >= 0 ? new Date(args[nowIdx + 1]) : new Date();

    const rows = JSON.parse(fs.readFileSync(file, "utf8")).map((r) => priceRow(r));
    const p = plan(rows, { now });

    console.log(`now (ICT)   ${p.now_ict}  weekday=${p.weekday}  in_window=${p.in_window}`);
    if (p.skip_reason) console.log(`skipped     ${p.skip_reason}`);
    console.log(`\nDUE NOW (${p.due_now.length})`);
    for (const d of p.due_now) console.log(`  ${d.province.padEnd(18)} ${d.date}  ${d.lots} lots / ${d.deeds} deeds`);

    console.log(`\nUPCOMING (${p.upcoming.length})`);
    for (const d of p.upcoming.slice(0, 12))
        console.log(`  ${d.province.padEnd(18)} ${d.date}  ${d.lots} lots / ${d.deeds} deeds`);

    if (p.overdue.length) {
        console.log(`\nOVERDUE (${p.overdue.length}) — round date already passed`);
        for (const d of p.overdue.slice(0, 12))
            console.log(`  ${d.province.padEnd(18)} ${d.date}  ${d.lots} lots / ${d.deeds} deeds`);
    }
}
