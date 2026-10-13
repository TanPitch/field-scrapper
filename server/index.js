/* server/index.js — read API over the scraped estate data.
 *
 * Read-only by design. The scrapers own writes; this only serves what they
 * produced, so there is one writer and no chance of the API mutating data the
 * scraper is mid-way through updating.
 *
 * Every response is honest about precision. A parcel can hold a กรมที่ดิน point,
 * a กรมธนารักย์ point, or only a subdistrict centroid, and `geoPrecision` says
 * which. The map uses it to avoid implying parcel accuracy it does not have.
 *
 *   DATABASE_URL=postgres://... bun server/index.js
 */
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pg from "pg";
import { router as usersRouter, SESSION_COOKIE } from "./users.js";

const { Pool } = pg;

/* lot_images.local_path holds a bare filename written by the scraper's
 * LocalImageStore. Resolving it needs exactly one root, so it is configured
 * here rather than duplicated per row. Default matches test/data/img.
 *
 * The frontend expects /img/land/..., which is what the scraper already
 * recorded as the image's logical path, so the mount matches that prefix. */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const IMAGE_ROOT = process.env.IMAGE_ROOT
    ? path.resolve(process.env.IMAGE_ROOT)
    : path.resolve(HERE, "..", "test", "data", "img");

const url = process.env.DATABASE_URL;
if (!url) {
    console.error("DATABASE_URL is required, e.g.");
    console.error("  DATABASE_URL=postgres://postgres:landmap@localhost:5433/landmap bun server/index.js");
    process.exit(1);
}

const pool = new Pool({ connectionString: url, max: 10 });
const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

/* Sessions live in Postgres so a sign-in survives an API restart, which is
 * exactly when you are most likely to be looking at it.
 *
 * SESSION_SECRET is required in production; the dev fallback is deliberate and
 * loud so nobody ships it by accident. */
if (!process.env.SESSION_SECRET && process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET is required in production");
}

/* connect-pg-simple is a FACTORY, not a class: it takes the express-session
 * module and returns a Store constructor. Calling it with `new` and handing it
 * our options object silently produced a store whose base class was undefined,
 * and the failure surfaced as a confusing `session.session.Store` type error
 * before the server ever listened. */
const PgSessionStore = connectPgSimple(session);

app.use(session({
    name: SESSION_COOKIE,
    secret: process.env.SESSION_SECRET ?? "dev-only-insecure-secret",
    store: new PgSessionStore({ pool }),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 30 * 24 * 3600 * 1000,
    },
}));

/* The users router needs the pool for its own queries and transactions. */
app.use("/api", (req, _res, next) => { req.db = pool; next(); });
app.use("/api", usersRouter);

app.use("/img/land", express.static(IMAGE_ROOT, {
    maxAge: "30d",
    fallthrough: true,
    index: false,
    setHeaders: (res) => res.setHeader("Cross-Origin-Resource-Policy", "cross-origin"),
}));

/* LED publishes land area as ไร่-งาน-ตร.วา, where 1 ไร่ = 4 งาน = 400 ตร.วา
 * and 1 งาน = 100 ตร.วา. Condo lots are ตร.ม. instead, so the caller must not
 * treat sqm as sqWa. */
const sqWa = (rai, ngan, wa) =>
    (Number(rai) || 0) * 400 + (Number(ngan) || 0) * 100 + (Number(wa) || 0);

const toNum = (v) => (v === null || v === undefined ? null : Number(v));
const isoDate = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);

/* ------------------------------------------------------------------ meta */

app.get("/api/health", async (_req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT (SELECT count(*) FROM parcels)::int AS parcels,
                   (SELECT count(*) FROM lot_images)::int AS imageRows`);
        res.json({ ok: true, parcels: rows[0].parcels, imageRows: rows[0].imageRows, imageRoot: IMAGE_ROOT });
    } catch (e) {
        res.status(503).json({ ok: false, error: e.message });
    }
});

/** Provinces we actually hold, with coverage, for the province picker. */
app.get("/api/provinces", async (_req, res) => {
    const { rows } = await pool.query(`
        SELECT p.code, p.name,
               count(DISTINCT p.id)                       AS parcels,
               count(*) FILTER (WHERE l.status='active')  AS active,
               count(*) FILTER (WHERE a.td_eva_price IS NOT NULL) AS priced,
               min(l.next_round_date)                     AS next_round
          FROM provinces p
          LEFT JOIN parcels a ON a.province_code = p.code
          LEFT JOIN auction_lots l ON l.parcel_id = a.id
         GROUP BY p.code, p.name
         HAVING count(DISTINCT a.id) > 0
         ORDER BY p.name`);
    res.json(rows.map((r) => ({
        code: r.code, name: r.name, parcels: r.parcels,
        active: r.active, priced: r.priced, nextRound: isoDate(r.next_round),
    })));
});

/** Coverage summary — how much of what we scraped is actually enriched. */
app.get("/api/stats", async (_req, res) => {
    const { rows } = await pool.query(`
        SELECT count(*)                                                   AS parcels,
               count(*) FILTER (WHERE td_eva_price IS NOT NULL)           AS td_priced,
               count(*) FILTER (WHERE geom IS NOT NULL)                   AS geocoded,
               count(*) FILTER (WHERE geo_precision='parcel')            AS parcel_precision,
               count(*) FILTER (WHERE geo_precision='subdistrict')       AS subdistrict_only,
               count(DISTINCT province_code)                              AS provinces
          FROM parcels`);
    const { rows: lots } = await pool.query(`
        SELECT count(*) AS lots,
               count(*) FILTER (WHERE status='active') AS active,
               count(DISTINCT case_no||case_year) AS cases
          FROM auction_lots`);
    const { rows: rounds } = await pool.query(`
        SELECT count(*) AS rounds,
               count(*) FILTER (WHERE is_held) AS held,
               count(*) FILTER (WHERE status_code=1) AS sold
          FROM auction_rounds`);
    res.json({ ...rows[0], ...lots[0], ...rounds[0] });
});

/* ------------------------------------------------------------ bot status */

/**
 * What the scraper is doing, for the settings page.
 *
 * A run with finished_at IS NULL is what "running now" means, so it is counted
 * before anything else. A run open for far longer than any province scrape
 * could plausibly take is reported as stuck rather than running, because a
 * killed process leaves the row open and the alternative is a page that claims
 * the bot is busy forever.
 */
const STUCK_AFTER_S = 60 * 60;

app.get("/api/status", async (_req, res) => {
    const { rows: runs } = await pool.query(`
        SELECT r.id, r.stage, r.province_code, p.name AS province_name,
               r.started_at_t AS started_at,
               r.finished_at, r.last_step, r.pages, r.lots_seen, r.lots_new,
               r.error_count, r.detail,
               extract(epoch FROM (coalesce(r.finished_at, now()) - r.started_at_t))::int AS duration_s
          FROM scrape_runs r
          LEFT JOIN provinces p ON p.code = r.province_code
         ORDER BY r.started_at_t DESC
         LIMIT 25`);

    const running = runs
        .filter((r) => !r.finished_at && r.stage !== "reference")
        .map((r) => ({
            id: r.id, stage: r.stage, province: r.province_name, provinceCode: r.province_code,
            startedAt: isoDate(r.started_at), step: r.last_step,
            elapsedS: r.duration_s,
            status: r.duration_s > STUCK_AFTER_S ? "stuck" : "running",
        }));

    const { rows: counts } = await pool.query(`
        SELECT count(*)                                            AS runs,
               count(*) FILTER (WHERE finished_at IS NULL)          AS unfinished,
               count(*) FILTER (WHERE error_count > 0)              AS failed,
               max(started_at_t)                                   AS last_run
          FROM scrape_runs`);

    const { rows: pend } = await pool.query(`
        SELECT count(*) FILTER (WHERE td_eva_price IS NULL AND td_status IS NULL) AS never_tried,
               count(*) FILTER (WHERE td_status LIKE 'unresolved%')             AS unresolved,
               count(*) FILTER (WHERE td_status LIKE 'skipped%')                AS skipped,
               count(*) FILTER (WHERE td_eva_price IS NOT NULL)                 AS enriched
          FROM parcels`);

    res.json({
        bot: {
            running: running.length,
            runningPasses: running,
            lastRun: isoDate(counts[0].last_run),
            totalRuns: counts[0].runs,
            unfinishedRuns: counts[0].unfinished,
            failedRuns: counts[0].failed,
        },
        backlog: {
            td: {
                enriched: pend[0].enriched,
                neverTried: pend[0].never_tried,
                unresolved: pend[0].unresolved,
                skipped: pend[0].skipped,
            },
        },
        recent: runs
            .filter((r) => r.finished_at)
            .slice(0, 12)
            .map((r) => ({
                id: r.id, stage: r.stage, province: r.province_name, provinceCode: r.province_code,
                startedAt: isoDate(r.started_at), finishedAt: isoDate(r.finished_at),
                durationS: r.duration_s,
                pages: r.pages, lotsSeen: r.lots_seen, lotsNew: r.lots_new,
                errors: r.error_count,
                outcome: r.error_count > 0 ? "failed" : "ok",
                detail: r.detail,
            })),
    });
});

/* ----------------------------------------------------------------- lists */

/**
 * Map view: one feature per parcel, in the shape MapLibre wants.
 * Bundles the lot so the pin can show price and status without a second call.
 */
app.get("/api/parcels", async (req, res) => {
    const province = req.query.province ? Number(req.query.province) : null;
    const onlyActive = req.query.active === "1";

    const { rows } = await pool.query(`
        SELECT p.id, p.deed_number, p.land_title, p.tumbol, p.district_name,
               p.province_code, p.tambon_code, p.tambon_match,
               p.td_lat, p.td_lon, p.td_eva_price, p.td_rawang, p.td_survey_no,
               p.td_land_no, p.td_status, p.geo_precision, p.geo_status,
               p.eva_price_min, p.eva_price_max,
               p.elevation_m, p.elevation_uncertainty_m, p.elevation_source,
               p.province_name, p.district_name AS district_full,
               ST_Y(p.geom::geometry) AS lat, ST_X(p.geom::geometry) AS lng,
               l.id AS lot_id, l.case_no, l.case_year, l.order_label,
               l.asset_type, l.size_unit, l.size_rai, l.size_ngan, l.size_wa,
               l.start_price, l.start_price_src, l.status, l.next_round_date,
               l.closed_at, l.close_reason, l.close_code, l.committee_price, l.led_price,
               l.officer_price, l.expert_price, l.published_date,
               l.first_round_date, l.bid_security, l.remark,
               l.court, l.plaintiff, l.defendant, l.owner, l.legal_exec_dept,
               /* There is no "collateral" column in this schema — the amount LED
                  publishes against the lot is bid_security, and a spouse
                  figure is not collected at all. Inventing a column name here is
                  what made this endpoint 500. */
               l.bid_security, l.next_round_price,
               /* Rounds aggregated in one row so the map, the table and the
                  rounds column all come from a single request. status_code is
                  included because the price ladder cannot be derived without it
                  — only code 3 deepens the discount. */
               (SELECT json_agg(json_build_object(
                          'idx', r.idx,
                          'date', r.round_date,
                          'status_code', r.status_code,
                          'label', r.status_label,
                          'is_held', r.is_held,
                          'discount_pct', r.discount_pct,
                          'price', r.price) ORDER BY r.idx)
                  FROM auction_rounds r WHERE r.lot_id = l.id) AS rounds,
               (SELECT count(*) FROM lot_images i WHERE i.lot_id = l.id)::int AS img_count,
               /* The stored filenames, so the detail panel can show the real
                  photographs rather than placeholders. local_path is a bare
                  filename; the API serves it under /img/land/. Capped, because a
                  lot with many images would otherwise bloat every map request. */
               (SELECT json_agg(x.local_path ORDER BY x.id)
                  FROM (SELECT id, local_path FROM lot_images
                         WHERE lot_id = l.id ORDER BY id LIMIT 8) x) AS img_paths
          FROM parcels p
          LEFT JOIN LATERAL (
                SELECT * FROM auction_lots WHERE parcel_id = p.id
                 ORDER BY (status='active') DESC, next_round_date ASC NULLS LAST, id
                 LIMIT 1) l ON true
         WHERE ($1::int IS NULL OR p.province_code = $1)
           AND ($2::bool IS NOT TRUE OR l.status = 'active')
         ORDER BY p.id`, [province, onlyActive]);

    res.json({
        type: "FeatureCollection",
        features: rows.map((r) => ({
            type: "Feature",
            geometry: r.lat === null || r.lng === null
                ? null : { type: "Point", coordinates: [Number(r.lng), Number(r.lat)] },
            properties: {
                id: r.id, lotId: r.lot_id, deed: r.deed_number,
                landTitle: r.land_title, tambon: r.tumbol, amphur: r.district_name,
                provinceCode: r.province_code, tambonCode: r.tambon_code,
                /* The real name, not a code. Showing 'จ.40' where 'ขอนแก่น' belongs
                   makes the column useless for grouping and reading. */
                provinceName: r.province_name, districtName: r.district_full,
                caseNo: r.case_no ? `${r.case_no}/${r.case_year}` : null,
                caseNoRaw: r.case_no, caseYear: r.case_year,
                court: r.court, plaintiff: r.plaintiff, defendant: r.defendant,
                owner: r.owner, department: r.legal_exec_dept,
                collateral: toNum(r.bid_security),
                /* Not collected by the scraper. Left null rather than guessed —
                   the UI renders "—" for it. */
                spouseCollateral: null,
                /* LED's own next-round figure, when it publishes one. The client
                   also derives one from the ladder; they should agree, and this
                   is the server's word to check against. */
                nextRoundPrice: toNum(r.next_round_price),
                order: r.order_label, assetType: r.asset_type,
                sizeUnit: r.size_unit,
                wah: r.size_unit === 'sqm' ? null : sqWa(r.size_rai, r.size_ngan, r.size_wa),
                askingPrice: toNum(r.start_price), askingSource: r.start_price_src,
                status: mapStatus(r.status, r.close_reason, r.close_code),
                nextRound: isoDate(r.next_round_date),
                closeReason: r.close_reason,
                /* The LED cascade's opening price — what the "smart price"
                   column shows. Distinct from askingPrice's meaning downstream:
                   this is the first rung, before any reduction. */
                startPrice: toNum(r.start_price),
                committeePrice: toNum(r.committee_price),
                ledPrice: toNum(r.led_price),
                officerPrice: toNum(r.officer_price),
                expertPrice: toNum(r.expert_price),
                bidSecurity: toNum(r.bid_security),
                publishedDate: isoDate(r.published_date),
                firstRoundDate: isoDate(r.first_round_date),
                remark: r.remark,
                imageCount: r.img_count ?? 0,
                images: Array.isArray(r.img_paths) ? r.img_paths.filter(Boolean) : [],
                rounds: Array.isArray(r.rounds) ? r.rounds : [],
                // กรมธนารักย์ per-parcel appraisal, the authoritative one
                evaPrice: toNum(r.td_eva_price),
                evaMin: toNum(r.eva_price_min), evaMax: toNum(r.eva_price_max),
                rawang: r.td_rawang, surveyNo: r.td_survey_no, landNo: r.td_land_no,
                geoPrecision: r.geo_precision ?? null,
                geoStatus: r.geo_status, tdStatus: r.td_status,
                /* Height, so the table can filter and sort on it without a second
                   round trip per row. Null where no DEM covers the point. */
                elevation: toNum(r.elevation_m),
                elevationUncertainty: toNum(r.elevation_uncertainty_m),
                elevationSource: r.elevation_source,
            },
        })),
    });
});

/* ---------------------------------------------------------------- detail */

/** One parcel with every lot, round, image and provenance row. */
app.get("/api/parcels/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "id must be an integer" });

    const { rows } = await pool.query(`
        SELECT p.*, ST_Y(p.geom::geometry) AS lat, ST_X(p.geom::geometry) AS lng
          FROM parcels p WHERE p.id = $1`, [id]);
    if (!rows.length) return res.status(404).json({ error: "no such parcel" });
    const p = rows[0];

    const { rows: lots } = await pool.query(`
        SELECT * FROM auction_lots WHERE parcel_id = $1
         ORDER BY first_round_date DESC, id DESC`, [id]);

    const { rows: rounds } = await pool.query(`
        SELECT r.* FROM auction_rounds r
          JOIN auction_lots l ON l.id = r.lot_id
         WHERE l.parcel_id = $1
         ORDER BY l.first_round_date DESC, r.idx`, [id]);

    const { rows: images } = await pool.query(`
        SELECT i.* FROM lot_images i
          JOIN auction_lots l ON l.id = i.lot_id
         WHERE l.parcel_id = $1`, [id]);

    /* Where each field came from, so the detail page can attribute it. */
    const { rows: prov } = await pool.query(`
        SELECT field_name, source_key, value_text, value_num, observed_on, observed_at
          FROM field_provenance
         WHERE entity_type='parcel' AND entity_id=$1
         ORDER BY source_key, field_name`, [id]);

    res.json({
        parcel: {
            id: p.id, deed: p.deed_number, landTitle: p.land_title,
            landTitleRaw: p.land_title_raw,
            tambon: p.tumbol, amphur: p.district_name, province: p.province_name,
            provinceCode: p.province_code, districtDolCode: p.district_dol_code,
            tambonCode: p.tambon_code, tambonMatch: p.tambon_match,
            lat: toNum(p.lat), lng: toNum(p.lng),
            geoPrecision: p.geo_precision, geoStatus: p.geo_status,
            geoNote: p.geo_note, tdStatus: p.td_status,
            valuation: {
                source: "กรมธนารักย์ (assessprice)",
                perSqWa: toNum(p.td_eva_price),
                rawang: p.td_rawang, surveyNo: p.td_survey_no, landNo: p.td_land_no,
                landOffice: p.td_office, checkedAt: p.td_checked_at,
            },
            areaBracket: {
                source: "กรมธนารักย์ open data (ตำบล-level)",
                min: toNum(p.eva_price_min), max: toNum(p.eva_price_max),
                avg: toNum(p.eva_price_avg), grades: toNum(p.eva_grade_count),
                note: "Fallback only. Systematically understates urban land; not a parcel price.",
            },
            firstSeen: p.first_seen, lastSeen: p.last_seen,
        },
        lots: lots.map((l) => ({
            id: l.id, caseNo: l.case_no, caseYear: l.case_year, court: l.court,
            plaintiff: l.plaintiff, defendant: l.defendant, owner: l.owner,
            department: l.legal_exec_dept, departmentKind: l.department,
            orderLabel: l.order_label, orderNumber: l.order_number, orderSub: l.order_sub,
            assetType: l.asset_type, remark: l.remark,
            publishedDate: isoDate(l.published_date),
            firstRoundDate: isoDate(l.first_round_date),
            size: {
                unit: l.size_unit,
                rai: toNum(l.size_rai), ngan: toNum(l.size_ngan), wa: toNum(l.size_wa),
                sqWa: l.size_unit === 'sqm' ? null : sqWa(l.size_rai, l.size_ngan, l.size_wa),
            },
            price: {
                start: toNum(l.start_price), source: l.start_price_src,
                committee: toNum(l.committee_price), led: toNum(l.led_price),
                officer: toNum(l.officer_price), expert: toNum(l.expert_price),
                bidSecurity: toNum(l.bid_security),
                nextRound: toNum(l.next_round_price),
            },
            status: l.status, closeCode: l.close_code, closeReason: l.close_reason,
            closedAt: isoDate(l.closed_at), nextRoundDate: isoDate(l.next_round_date),
            rounds: rounds.filter((r) => r.lot_id === l.id).map((r) => ({
                idx: r.idx, date: isoDate(r.round_date),
                statusCode: r.status_code, statusLabel: r.status_label,
                isHeld: r.is_held, discountPct: r.discount_pct, price: toNum(r.price),
            })),
            images: images.filter((i) => i.lot_id === l.id).map((i) => ({
                kind: i.kind,
                /* local_path is a bare filename inside IMAGE_ROOT; the browser
                   needs a URL, so it is resolved here rather than stored twice. */
                url: `/img/land/${i.local_path}`,
                sourceUrl: i.url,
                fetchedAt: i.fetched_at,
            })),
        })),
        provenance: prov.map((v) => ({
            field: v.field_name, source: v.source_key,
            value: v.value_num ?? v.value_text, observedOn: isoDate(v.observed_on),
        })),
    });
});

/**
 * Database lot status -> the three the UI shows.
 *
 *   sale     — still listed
 *   sold     — ended with a buyer
 *   inactive — ran every round unsold and was pulled from the listing
 *
 * The database distinguishes 'closed' from 'inactive' and records why a lot
 * closed, so that reason is used rather than guessing from the status alone:
 * a seizure revoked or a cancelled remainder is not a sale, and showing it as
 * "ขายแล้ว" would be a straightforward lie.
 */
function mapStatus(status, closeReason, closeCode) {
  if (status === 'active') return 'sale';
  if (status === 'inactive') return 'inactive';
  if (closeCode === 1 || closeReason === 'sold') return 'sold';
  /* Ended without a buyer: seizure revoked, or cancelled with rounds left. */
  return 'inactive';
}

/* 404 for unknown API routes, rather than Express's HTML default. */
app.use("/api", (_req, res) => res.status(404).json({ error: "unknown endpoint" }));
const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, () => {
    console.log(`api listening on http://localhost:${PORT}`);
    console.log(`  images served from ${IMAGE_ROOT} at /img/land/`);
    console.log(`  GET /api/health`);
    console.log(`  GET /api/status`);
    console.log(`  GET /api/provinces`);
    console.log(`  GET /api/stats`);
    console.log(`  GET /api/parcels?province=40`);
    console.log(`  GET /api/parcels/:id`);
});

process.on("SIGTERM", () => pool.end().then(() => process.exit(0)));
process.on("SIGINT", () => pool.end().then(() => process.exit(0)));
