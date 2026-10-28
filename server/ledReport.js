/* ledReport.js — LED's reports.asp answer sheet, fetched and applied.
 *
 * The auction_rounds.price column holds the scheduled (ประกาศ) figure, which is
 * NOT the money a winner paid: ผบE.390/2568 carries 1,185,780 in every round
 * while LED's own report prints ราคาขายได้ 1,540,000. The report page is the
 * only source with the per-round outcome (ผลการขาย) and the winning bid, so
 * this module pulls one case's sheet and applies it:
 *
 *   - existing rounds with the same date get status_label refreshed and —
 *     when the outcome is ขายได้ — their sold_price stored;
 *   - report rows for dates the lot has no round for get a NEW row: the
 *     suspend-and-relist history (ผบ.2545/2562 shows six งดขายไม่มีผู้สู้ราคา
 *     rounds here while newbidreg only lists the next cycle);
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
    let neg = -100; /* scratch idx for fresh rows, decremented per insert */

    for (const r of mine) {
      if (!r.date) continue;
      const sold = r.outcome.startsWith("ขายได้") ? r.soldPrice : null;
      /* Matching an existing round: refresh the LED label and (when the row
         sold) the winning bid. status_code stays ours - the ingest already
         encodes its own family for those rows. */
      const upd = await pool.query(
        `UPDATE auction_rounds
            SET status_label = $3,
                sold_price = COALESCE($4, sold_price)
          WHERE lot_id = $1 AND round_date = $2
          RETURNING id`, [lot.id, r.date, r.outcome, sold]);
      if (upd.rowCount > 0) { roundsUpdated += 1; continue; }

      await pool.query(
        `INSERT INTO auction_rounds (lot_id, idx, round_date, status_code, status_label, price, sold_price)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [lot.id, --neg, r.date, codeFor(r.outcome), r.outcome, r.appraisal, sold]);
      roundsInserted += 1;
    }

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

    /* Renumber idx = chronological rank, so `ORDER BY r.idx` keeps reading as
       the sale's timeline even with history rows prepended. Two passes: the
       first clears space with distinct negatives (a plain -id would overflow
       smallint on later rows and would not be distinct either), the second
       writes the final rank. */
    await pool.query(`
      WITH negated AS (
          SELECT id, -row_number() OVER (ORDER BY id) AS idx
            FROM auction_rounds WHERE lot_id = $1)
      UPDATE auction_rounds r SET idx = negated.idx
        FROM negated WHERE negated.id = r.id`, [lot.id]);
    await pool.query(`
      WITH ranked AS (
          SELECT id, row_number() OVER (
                     ORDER BY CASE WHEN round_date IS NULL THEN 1 ELSE 0 END,
                              round_date NULLS LAST, id) AS rank
            FROM auction_rounds WHERE lot_id = $1)
      UPDATE auction_rounds r SET idx = ranked.rank
        FROM ranked WHERE ranked.id = r.id`, [lot.id]);
  }

  /* Even a sheet with no rows for our deed was fetched and learned - stamp it
     so one unsynced case cannot poll the bulk loop forever. */
  await pool.query(
    `UPDATE auction_lots SET led_report_seen = now()
      WHERE case_no = $1 AND case_year = $2`, [caseNo, yearForDb]);

  return { case: `${caseNo}/${yearForDb}`, rows: rows.length, lots: lots.length, roundsUpdated, roundsInserted, lotsSold };
}
