/* ledReport.js — LED's reports.asp answer sheet, fetched and applied.
 *
 * The auction_rounds.price column holds the scheduled (ประกาศ) figure, which is
 * NOT the money a winner paid: ผบE.390/2568 carries 1,185,780 in every round
 * while LED's own report prints ราคาขายได้ 1,540,000. The report page is the
 * only source with the per-round outcome (ผลการขาย) and the winning bid, so
 * this module pulls one case's sheet and applies it:
 *
 *   - existing rounds with the same date get led_label (the report's ผลการขาย)
 *     refreshed into its own column and — when the outcome is ขายได้ — their
 *     sold_price stored. The lists label and code stay untouched: the schedule
 *     (test/ingest.js, SELL_STATUS[code]) and the report may disagree about
 *     the same date and the panel shows both lines;
 *   - report rows for dates BEFORE the lot's first round get a NEW row (idx
 *     NULL, source='report') — the suspend-and-relist history (ผบ.2545/2562
 *     shows six งดขายไม่มีผู้สู้ราคา rounds here while newbidreg only lists
 *     the next cycle). Future or unseen dates the ingest's lists payload
 *     does not carry are skipped: that is what said the cross-cycle
 *     contamination of ผบ.2255/2562 in the first place; this sheet owns the
 *     outcomes, the ingest owns which rounds exist;
 *   - the lot's winning bid is stamped on auction_lots.sold_price;
 *   - every lot of the case gets led_report_seen stamped, which is what keeps
 *     the bulk sync from re-pulling the same sheet forever.
 *
 * Two things the site taught us the hard way:
 *   1. The page is windows-874, so the POST body must be TIS-620 bytes. A
 *      UTF-8 body comes back as the bare_form echo — every earlier probe that
 *      concluded "the endpoint is broken" had just sent the wrong bytes.
 *   2. One case number spans courts and provinces (ผบ.2545/2562 resolves to
 *      174 report rows across 11 courts). Report rows are matched to our lot
 *      only through the deed number on the row, never by case alone.
 */

const BASE = "https://asset.led.go.th/report_new/reports.asp";
const MENU = "https://asset.led.go.th/report_new/reportm.asp";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* TIS-620 (windows-874) encoder — the Thai block maps linearly, 0xA1..0xFB. */
export function tis(s) {
  return Buffer.from([...String(s)].map((ch) => {
    const c = ch.codePointAt(0);
    if (c >= 0x0e01 && c <= 0x0e3a) return c - 0x0e01 + 0xa1;
    if (c >= 0x0e3f && c <= 0x0e5b) return c - 0x0e3f + 0xdf;
    return c < 128 ? c : 0x3f; /* asking for it → '?', never a fake codepoint */
  }));
}

const pct = (b) =>
  (/[\w.~-]/.test(String.fromCharCode(b)) && b < 128 ? String.fromCharCode(b) : "%" + b.toString(16).toUpperCase().padStart(2, "0"));
const enc = (s) => [...tis(s)].map(pct).join("");
const body874 = (fields) => Object.entries(fields).map(([k, v]) => `${enc(k)}=${enc(v)}`).join("&");

const stripCells = (tr) =>
  tr.replace(/<\/t[dh]>/gi, " | ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
    .split(" | ")
    .map((c) => c.trim().replace(/(\s*\|)+$/, "").trim())

/* BE date 21-01-2570 -> ISO 2027-01-21 (+543 the other way) */
export const beIso = (d) => {
  const m = /^(\d\d)-(\d\d)-(\d{4})$/.exec(d.trim());
  if (!m) return null;
  return `${String(Number(m[3]) - 543).padStart(4, "0")}-${m[2]}-${m[1]}`;
};

const num = (s) => {
  if (!s) return null;
  const n = Number(String(s).replace(/[,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** One page → { rows, bare }.
 *  bare = the form echoed with no result table: the search learned nothing
 *  (wrong case, LED hiccup) and the caller must not read it as success. */
export function parseResult(html) {
  const table = html.match(/<table class="table[\s\S]{100,}?<\/table>/i)?.[0] ?? "";
  const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((m) => stripCells(m[1]))
    .filter((c) => c.length >= 9 && /^\d\d-\d\d-\d\d\d\d$/.test(c[0]))
    .map((c) => ({
      date: beIso(c[0]),
      court: c[1],
      case: c[2],
      deed: c[3],
      type: c[5],
      appraisal: num(c[6]),
      outcome: c[7],
      soldPrice: num(c[8]),
    }));
  return { rows, bare: rows.length === 0 && /report_search/.test(html) };
}

/* Outcome label → the status_code family ledger already allows. Codes are not
 * written onto existing rows (the ingest knows its own codes); this only
 * classifies rows the report introduces that we had never seen.
 *
 * Those rows are, in practice, LED's history of a case it suspended and then
 * re-listed at a NEW floor (ผบ.2545/2562: six งดขายไม่มีผู้สู้ราคา rows at
 * 98,329,928, relisted at 80,177,600). They get the non-deepening งดขาย-family
 * code 10: code 3 tells the price ladder the same listing deepened, and a
 * relist is the opposite of that — LED re-set the floor instead of deepening,
 * so a code 3 here would price the current cycle off 98.3M × 0.7. */
const codeFor = (label) => {
  if (/ขายได้/.test(label)) return 1;
  if (/ถอนการยึด/.test(label)) return 6;
  return 10;
};

const FETCH_GAP_MS = 2600; /* politeness between LED hits */
let lastHit = 0;
const gap = async () => {
  const wait = Math.max(0, lastHit + FETCH_GAP_MS - Date.now());
  if (wait) await sleep(wait);
};

/** POST one case's answer sheet (menu first, like a browser session). */
export async function fetchLedReport(caseNo, year) {
  await gap();
  lastHit = Date.now();
  const menu = await fetch(MENU, {
    headers: { "User-Agent": UA, "Accept-Language": "th,en;q=0.8" },
    signal: AbortSignal.timeout(45000),
  });
  const cs = menu.headers.getSetCookie?.() ?? [];
  await menu.arrayBuffer();
  await sleep(1200);
  const res = await fetch(BASE, {
    method: "POST",
    headers: {
      "User-Agent": UA, "Accept-Language": "th,en;q=0.8",
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: BASE,
      Cookie: cs.map((c) => c.split(";")[0]).join("; "),
    },
    body: body874({ ALAW_SUIT_NO: caseNo, ALAW_SUIT_YEAR: String(year), person1: "", startdate: "", Action: " ค้นหา " }),
    signal: AbortSignal.timeout(45000),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  const head = buf.subarray(0, 4096).toString("latin1").toLowerCase();
  const html = /utf-8/.test(head) ? new TextDecoder("utf-8").decode(buf) : new TextDecoder("windows-874").decode(buf);
  return { status: res.status, html };
}

/* One in-flight promise per case: clicking the same land twice must not fire
 * two LED posts. Failures are removed from the memo so the next click retries
 * rather than caching a dead promise forever. */
const inflight = new Map();

export function syncCaseReport(pool, caseNo, year) {
  const key = `${caseNo}/${year}`;
  const running = inflight.get(key);
  if (running) return running;
  const job = applyCase(pool, caseNo, year).catch((e) => {
    inflight.delete(key);
    throw e;
  });
  inflight.set(key, job);
  return job;
}

/** Report rows can carry a comma list of deeds on one row ("3438, 22675").
 *  A lot matches when its deed is one of the list. */
const deedAb = (deedStr) => new Set(String(deedStr ?? "").split(/[,/]/).map((s) => s.replace(/\s+/g, "")).filter(Boolean));

async function applyCase(pool, caseNo, year) {
  const yearForDb = Number(year);
  if (!caseNo || !Number.isFinite(yearForDb)) throw new Error("bad case key");

  const { status, html } = await fetchLedReport(caseNo, yearForDb);
  if (status !== 200) throw new Error(`LED HTTP ${status}`);
  const { rows, bare } = parseResult(html);
  if (bare) throw new Error("LED returned the bare form (no results)");
  /* Rows land newest-first. Everything below wants old→new, so flip once. */
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const { rows: lots } = await pool.query(
    `SELECT id, deed_number, court FROM auction_lots
      WHERE case_no = $1 AND case_year = $2`, [caseNo, yearForDb]);

  let roundsUpdated = 0, roundsInserted = 0, lotsSold = 0;
  for (const lot of lots) {
    const mine = rows.filter((r) => deedAb(r.deed).has(String(lot.deed_number ?? "")));
    if (!mine.length) continue;

    /* History rows allowed for this lot: only dates before its first dated
       round. min() over the stored rows, not auction_lots.first_round_date -
       a lot whose ingest run has not landed yet has no first_round_date, and
       history for such a lot is still valid report data. Cast to text so the
       comparison below is string-to-string: pg hands back a local-midnight
       Date for a date column, and re-stringifying it through toISOString
       shifts the day back one in the +7 timezone. */
    const md = await pool.query(
      `SELECT min(round_date)::text AS min_date FROM auction_rounds
        WHERE lot_id = $1 AND round_date IS NOT NULL`, [lot.id]);
    const minDate = md.rows[0]?.min_date ?? null;

    for (const r of mine) {
      if (!r.date) continue;
      const sold = r.outcome.startsWith("ขายได้") ? r.soldPrice : null;
      /* Matching an existing round: the outcome goes to its own column and,
         when the row sold, the winning bid. status_code and status_label are
         the lists page's words — the report may call the same date something
         else and overwriting them is how ผบ.2255/2562's labels got crossed
         between two sale orders' cycles. */
      const upd = await pool.query(
        `UPDATE auction_rounds
            SET led_label = $3,
                sold_price = COALESCE($4, sold_price)
          WHERE lot_id = $1 AND round_date = $2
          RETURNING id`, [lot.id, r.date, r.outcome, sold]);
      if (upd.rowCount > 0) { roundsUpdated += 1; continue; }

      /* No such date: a new row is history ONLY when it predates everything
         the lists schedule knows. Any other unseen date is a round the lists
         page does not know about either — writing it would interleave the
         report's view into the ingest's schedule (the contamination bug),
         and the value is worse than the risk: the next ingest payload will
         carry the real future rounds when LED prints them. */
      if (minDate === null || !(r.date < minDate)) continue;

      await pool.query(
        `INSERT INTO auction_rounds (lot_id, idx, round_date, status_code, status_label, price, sold_price, led_label, source)
         VALUES ($1, NULL, $2, $3, $4, $5, $6, $4, 'report')`,
        [lot.id, r.date, codeFor(r.outcome), r.outcome, r.appraisal, sold]);
      roundsInserted += 1;
    }

    /* idx is NOT touched. It stopped being display order with 029: the API
       orders rounds by round_date, and the ingest's cleanup relies on the
       (lot's rows keyed) idx slots staying exactly what the lists payload
       said they were. Renumbering every row chronologically was what broke
       the ingest's upsert key in the first place. */

    /* The lot's winning bid: its latest sold round. NULL when the report has
       no ขายได้ row for this deed - staying null means "unsold", never 0. */
    const bid = await pool.query(
      `SELECT r.sold_price FROM auction_rounds r
         WHERE r.lot_id = $1 AND r.sold_price IS NOT NULL
         ORDER BY CASE WHEN r.round_date IS NULL THEN 1 ELSE 0 END, r.round_date DESC
         LIMIT 1`, [lot.id]);
    if (bid.rows[0]?.sold_price != null) {
      await pool.query(`UPDATE auction_lots SET sold_price = $2 WHERE id = $1`, [lot.id, bid.rows[0].sold_price]);
      lotsSold += 1;
    }
  }

  /* The sheet was fetched and learned even when it holds nothing for our
     deed, so one unsynced case cannot poll the bulk loop forever. */
  await pool.query(
    `UPDATE auction_lots SET led_report_seen = now()
      WHERE case_no = $1 AND case_year = $2`, [caseNo, yearForDb]);

  return { case: `${caseNo}/${yearForDb}`, rows: rows.length, lots: lots.length, roundsUpdated, roundsInserted, lotsSold };
}
