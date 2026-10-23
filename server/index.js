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
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pg from "pg";
import { router as usersRouter, requireAdmin, SESSION_COOKIE } from "./users.js";
import { mapStatus as mapLotStatus } from "./mapStatus.js";

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

/* An idle pooled connection that dies (Postgres restart, failover, a dropped
 * socket) makes pg emit 'error' on the pool itself. With no listener that is an
 * unhandled 'error' event, which terminates the process: the whole API goes
 * down because one idle connection went away, and every in-flight request with
 * it. pg documents this listener as required; the pool discards the dead client
 * and the next query opens a fresh one. */
pool.on("error", (e) => console.error("[pg pool]", e.message));

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
        /* imageRoot used to be echoed here. Nothing on the client reads it, and
         * it hands an absolute filesystem path to an unauthenticated caller, so
         * it is an information leak with no consumer. */
        res.json({ ok: true, parcels: rows[0].parcels, imageRows: rows[0].imageRows });
    } catch (e) {
        res.status(503).json({ ok: false, error: e.message });
    }
});

/** Provinces we actually hold, with coverage, for the province picker. */
app.get("/api/provinces", async (_req, res) => {
    const { rows } = await pool.query(`
        SELECT p.code, p.name,
               /* count(DISTINCT p.id) counted the provinces row - always 1,
                  because p.code is the group key. Every province therefore
                  advertised exactly one parcel while its lot counts said
                  thousands. The parcel count is a.id. */
               count(DISTINCT a.id)                       AS parcels,
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
               /* count(DISTINCT ...) ignores nulls, and concat gives null for a
                  lot with no case number - so those lots were invisible in the
                  total, and '1'+'23' collided with '12'+'3'. A row constructor
                  compares the pair as one value and neither problem exists. */
               count(DISTINCT (case_no, case_year)) AS cases
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
               r.error_count, r.notes, r.detail,
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
            .slice(0, 40)
            .map((r) => ({
                id: r.id, stage: r.stage, province: r.province_name, provinceCode: r.province_code,
                startedAt: isoDate(r.started_at), finishedAt: isoDate(r.finished_at),
                durationS: r.duration_s,
                pages: r.pages, lotsSeen: r.lots_seen, lotsNew: r.lots_new,
                errors: r.error_count,
                outcome: r.error_count > 0 ? "failed" : "ok",
                /* The history pane reads lastStep and notes, and neither was ever
                   sent - it has been rendering a blank line for every run while
                   the data sat in the table. Both are populated by the scrapers;
                   the resolver's note is the DOL tally, which is the only place
                   that count is written down anywhere. */
                lastStep: r.last_step,
                notes: r.notes,
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
               /* dol_lat/dol_lon have to be selected for the resolver cascade
                  below to have anything to fall back to. They were missing, so
                  the dol_lat fallback read undefined and a parcel whose only
                  coordinate came from DOL had a null geometry and no marker. */
               p.td_lat, p.td_lon, p.dol_lat, p.dol_lon,
               p.td_eva_price, p.td_rawang, p.td_survey_no,
               p.td_land_no, p.td_status, p.dol_status, p.td_verdict, p.dol_verdict, p.geo_precision, p.geo_status,
               p.eva_price_min, p.eva_price_max,
               p.elevation_m, p.elevation_uncertainty_m, p.elevation_source,
               p.province_name, p.district_name AS district_full,
               ST_Y(p.geom::geometry) AS lat, ST_X(p.geom::geometry) AS lng,
               l.id AS lot_id, l.case_no, l.case_year, l.order_label,
               l.asset_type, l.size_unit, l.size_rai, l.size_ngan, l.size_wa,
               l.start_price, l.start_price_src, l.status, l.next_round_date,
               l.closed_at, l.close_reason, l.close_code, l.committee_price, l.led_price,
               l.officer_price, l.expert_price, l.published_date,
               l.first_round_date, l.bid_security, l.remark, l.group_lot_count,
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
                          WHERE lot_id = l.id ORDER BY id LIMIT 8) x) AS img_paths,
               /* How many lots sit behind this parcel. A condominium building
                  is one cadastral parcel sold as N separate units, so the
                  answer is the unit count and the marker needs to say so -
                  otherwise a lone unit and a five-unit building look identical
                  on the map. Computed rather than stored: it is a property of
                  the join, not a fact about the land. */
               (SELECT count(*)::int FROM auction_lots x WHERE x.parcel_id = p.id) AS lot_count
/* Only parcels that actually carry a lot are published. ingest.js writes one
   parcel per deed number, but LED sells a condominium building as a single
   auction with one lot: the other ten "parcels" are the building's units, not
   land. They resolved to real coordinates, so they drew markers, and each showed
   an empty shell - no case, no deed, no price, no size. A row with no lot has
   nothing to assert, so it is not data the map should claim to have. */
FROM parcels p
          LEFT JOIN auction_lots l ON l.parcel_id = p.id
         WHERE l.id IS NOT NULL
           AND ($1::int IS NULL OR p.province_code = $1)
           AND ($2::bool IS NOT TRUE OR l.status = 'active')
         ORDER BY p.id`, [province, onlyActive]);

    res.json({
        type: "FeatureCollection",
        features: rows.map((r) => {
            /* geom is legacy and nothing writes it, so reading ST_Y(p.geom) alone
             * gave every parcel a null geometry and an empty map. The resolve
             * cascade writes td_lat/td_lon and dol_lat/dol_lon instead. Prefer
             * geom when it is somehow populated, then TD, then DOL - DOL is last
             * because its quota is 20/day and TD is the primary source. */
            const lat = r.lat ?? r.td_lat ?? r.dol_lat;
            const lng = r.lng ?? r.td_lon ?? r.dol_lon;
            return {
            type: "Feature",
            geometry: lat == null || lng == null
                ? null : { type: "Point", coordinates: [Number(lng), Number(lat)] },
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
                /* LED's own "รวม N แปลง" for a group sale (migration 014) — how
                   many parcels are auctioned as one lot this sale order. The
                   client regroups siblings and highlights them all. */
                groupCount: toNum(r.group_lot_count) ?? 1,
                sizeUnit: r.size_unit,
                /* LED puts a ห้องชุด floor area in the same rai/ngan/wa triple as
                 * land, so the figure is sent either way; nulling it for condo
                 * lots left the popup showing a dash for a size LED had given us. */
                wah: sqWa(r.size_rai, r.size_ngan, r.size_wa),
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
                /* The unit badge the marker popup reads. The query already
                   computes it as lot_count; without this in the payload it was
                   computed and thrown away, p.lotCount was always undefined,
                   and every condo building lost its xN in the popup while the
                   detail panel - which counts the units client-side - showed it
                   correctly. Two sources for one fact, and only one was fed. */
                lotCount: r.lot_count ?? 0,
                images: Array.isArray(r.img_paths) ? r.img_paths.filter(Boolean) : [],
                rounds: Array.isArray(r.rounds) ? r.rounds : [],
                // กรมธนารักย์ per-parcel appraisal, the authoritative one
                evaPrice: toNum(r.td_eva_price),
                evaMin: toNum(r.eva_price_min), evaMax: toNum(r.eva_price_max),
                rawang: r.td_rawang, surveyNo: r.td_survey_no, landNo: r.td_land_no,
                geoPrecision: r.geo_precision ?? null,
                geoStatus: r.geo_status, tdStatus: r.td_status, dolStatus: r.dol_status,
                tdVerdict: r.td_verdict, dolVerdict: r.dol_verdict,
                /* Height, so the table can filter and sort on it without a second
                   round trip per row. Null where no DEM covers the point. */
                elevation: toNum(r.elevation_m),
                elevationUncertainty: toNum(r.elevation_uncertainty_m),
                elevationSource: r.elevation_source,
            },
        };
        }),
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
 *
 * The body lives in mapStatus.js so it can be tested - see the file for why
 * that turned out to matter.
 */
const mapStatus = mapLotStatus;

/* ------------------------------------------------------- admin: data quality
 *
 * The resolve cascade is LED -> TD -> DOL. TD resolves most parcels; DOL fills
 * the rest but has a hard 20 calls/day quota enforced server-side, so the
 * backlog is real. This lists what is still missing or looks wrong, so an admin
 * can see the shape of the problem and correct rows by hand instead of waiting
 * for a crawl to stumble onto them again.
 *
 * The reason a parcel is in this list is derived, not stored: td_status and
 * dol_status only ever say "resolved", so anything absent has to be inferred
 * from which columns are null. That is enough to triage, but it means a row
 * resolved but wrong does not appear here - only unresolved ones do.
 */
app.get("/api/admin/coord-gaps", requireAdmin, async (req, res) => { try {
    const province = Number(req.query.province) || null;
    const kind = String(req.query.kind ?? "");
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    /* Resolved is "anything non-null", not a string match. Two writers spell it
     * differently - resolveTdParcels.js writes 'resolved_via_td', the coord
     * queue writes 'resolved' - and matching on one literal listed 761 genuinely
     * resolved Phuket parcels as gaps. */
    const where = [
        `p.td_status IS NULL AND p.dol_status IS NULL`,
        `p.td_lat IS NULL AND p.dol_lat IS NULL`,
        `p.deed_number IS NULL OR p.deed_number = ''`,
    ];
    if (province) where.push(`p.province_code = $1`);
    const params = province ? [province] : [];

    const { rows: gaps } = await pool.query(`
        SELECT p.id, p.province_code, p.province_name, p.district_name, p.district_dol_code,
               p.deed_number, p.land_title, p.td_status, p.dol_status, p.td_verdict, p.dol_verdict,
               p.td_rawang, p.td_lat, p.td_lon, p.dol_lat, p.dol_lon,
               p.td_object_id, p.td_eva_price, p.dol_office, p.dol_land_type,
               p.geo_status, p.tambon_match, p.geo_note,
               l.size_rai, l.size_ngan, l.size_wa, l.start_price, l.case_no, l.case_year,
               d.name AS district_ref, d.td_code, d.td_province_code, d.td_match_method, d.td_note
          FROM parcels p
          LEFT JOIN districts d
                 ON d.province_id = p.province_code AND d.dol_code = p.district_dol_code
          LEFT JOIN LATERAL (
                 SELECT * FROM auction_lots WHERE parcel_id = p.id ORDER BY id LIMIT 1
               ) l ON true
         WHERE (${where.join(" OR ")})
           AND ($1::int IS NULL OR p.province_code = $1)
           /* Only a parcel the map actually shows can be a gap the admin has to
              close. ingest.js makes a parcel for every deed number LED names,
              and for a condominium that is one parcel per unit of the same
              auction - they carry no lot, the API does not publish them, and
              nobody has ever seen them. Listing them here put 97 rows of
              nothing in front of the admin. */
           AND EXISTS (SELECT 1 FROM auction_lots x WHERE x.parcel_id = p.id)
         ORDER BY p.province_code, p.district_dol_code, p.deed_number NULLS FIRST
         LIMIT $2 OFFSET $3`,
        [params[0] ?? null, limit, offset]);

    const { rows: summary } = await pool.query(`
  SELECT
    count(*) FILTER (WHERE td_verdict = 'match' OR dol_verdict = 'match')         AS matched,
    count(*) FILTER (WHERE td_verdict = 'district_mismatch')                      AS mismatch,
    count(*) FILTER (WHERE dol_verdict = 'pending_quota')                         AS waiting_dol,
    count(*) FILTER (WHERE td_verdict = 'no_result' OR dol_verdict = 'no_result')  AS dead_end,
     count(*) FILTER (WHERE dol_verdict = 'tambon_mismatch')                     AS wrong_tambon,
     count(*) FILTER (WHERE dol_verdict = 'district_mismatch')                   AS wrong_district,
     count(*) FILTER (WHERE dol_verdict = 'ambiguous')                           AS ambiguous,
     count(*) FILTER (WHERE dol_verdict = 'area_mismatch')                       AS wrong_area,
    count(*) FILTER (WHERE td_verdict IS NULL AND dol_verdict IS NULL)            AS never_tried,
    count(*) FILTER (WHERE deed_number IS NULL OR deed_number = '')               AS no_deed,
    count(*)                                                                        AS total
        FROM parcels`);

    res.json({ gaps, summary: summary[0], limit, offset });
      } catch (e) { console.error("[coord-gaps]", e); res.status(500).json({ error: e.message }); }
});

/** The values the parcels.geo_status CHECK constraint actually allows. */
const GEO_STATUSES = ["unresolved", "verified", "mismatch"];

/** One row's manual correction. Narrow on purpose: an admin is fixing the
 * resolver's misses, not rewriting parcel records. Every field is written
 * through COALESCE so a partial body never blanks a column. */
app.patch("/api/admin/coord-gaps/:id", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "id must be an integer" });

    /* td_* and dol_* are answers from two different sources to the same
     * question, and they were collapsed into one lat/lng pair with `??`. A body
     * carrying only dol_lat/dol_lon therefore also wrote td_lat/td_lon - so
     * setting a DOL coordinate silently overwrote a TD coordinate the admin
     * never meant to touch, and the wrong figure became the one the cascade
     * prefers. The two pairs are kept apart and written independently. */
    const tdLat = req.body?.td_lat ?? null;
    const tdLng = req.body?.td_lon ?? null;
    const dolLat = req.body?.dol_lat ?? null;
    const dolLng = req.body?.dol_lon ?? null;

    for (const [v, limit, what] of [
        [tdLat, 90, "latitude"], [dolLat, 90, "latitude"],
        [tdLng, 180, "longitude"], [dolLng, 180, "longitude"],
    ]) {
        if (v != null && (!Number.isFinite(Number(v)) || Math.abs(Number(v)) > limit))
            return res.status(400).json({ error: `${what} out of range` });
    }
    /* Half a coordinate is not a fix: it would put a latitude in the row with no
     * longitude, which reads as resolved to everything downstream. */
    if ((tdLat == null) !== (tdLng == null))
        return res.status(400).json({ error: "td_lat and td_lon must be set together" });
    if ((dolLat == null) !== (dolLng == null))
        return res.status(400).json({ error: "dol_lat and dol_lon must be set together" });

    /* geo_status has to be one of the three the CHECK constraint allows, and
     * this endpoint used to default it to "manual" - a value the schema does
     * not have. Every PATCH it ever received died on 23514, so no admin could
     * fix a coordinate by hand at all; the 500 said nothing about why. A
     * coordinate a person typed in is "verified", which is in the enum. */
    const geoStatus = String(req.body?.geo_status ?? "verified");
    if (!GEO_STATUSES.includes(geoStatus))
        return res.status(400).json({ error: `geo_status must be one of ${GEO_STATUSES.join(", ")}` });

    const { rows } = await pool.query(`
        UPDATE parcels
           SET td_status   = COALESCE($2, td_status),
               dol_status  = COALESCE($3, dol_status),
               td_rawang   = COALESCE($4, td_rawang),
               td_lat      = COALESCE($5, td_lat),
               td_lon      = COALESCE($6, td_lon),
               dol_lat     = COALESCE($7, dol_lat),
               dol_lon     = COALESCE($8, dol_lon),
               dol_office  = COALESCE($9, dol_office),
               geo_status  = COALESCE($10, geo_status),
               geo_note    = COALESCE($11, geo_note)
         WHERE id = $1
      RETURNING id, td_status, dol_status, td_lat, td_lon, dol_lat, dol_lon, geo_note`,
        [id,
         req.body?.td_status ?? null,
         req.body?.dol_status ?? null,
         req.body?.td_rawang ?? null,
         tdLat, tdLng, dolLat, dolLng,
         req.body?.dol_office ?? null,
         geoStatus,
         req.body?.geo_note ?? `set by admin ${req.session?.userId ?? "?"}`,
        ]);
    if (!rows.length) return res.status(404).json({ error: "no such parcel" });
    res.json(rows[0]);
});

/* 404 for unknown API routes, rather than Express's HTML default. Registered
 * before listen(): the previous version sat after app.listen(), which worked
 * only because the request loop starts later than the next synchronous line.
 * Route order should be what the file says it is. */
app.use("/api", (_req, res) => res.status(404).json({ error: "unknown endpoint" }));

/* Built frontend when it exists (the Docker image carries dist/): serve the
 * static bundle and hand the remaining GET paths to the SPA. Plain middleware
 * on purpose - Express 5's path-pattern syntax buys nothing for one fallback.
 * In dev dist/ is absent, so nothing is mounted and Vite's :5173 keeps doing
 * this job through its /api and /img proxies. */
const DIST = path.resolve(HERE, "..", "dist");
if (fs.existsSync(path.join(DIST, "index.html"))) {
    app.use(express.static(DIST, { maxAge: "1h", index: false, fallthrough: true }));
    app.use((req, res, next) => {
        if (req.method !== "GET" || req.path.startsWith("/api/")
            || req.path.startsWith("/img/")) return next();
        res.sendFile(path.join(DIST, "index.html"));
    });
    console.log(`  frontend served from ${DIST}`);
}

/* Every route above queries Postgres, and Express's default error handler
 * answers with an HTML body - which lib/api.ts can only report to the user as
 * "the server failed" - plus the stack trace whenever NODE_ENV is not
 * production. One JSON shape keeps the client's error contract, and the detail
 * stays in the log where it belongs. */
app.use((err, _req, res, _next) => {
    console.error("[api]", err);
    if (res.headersSent) return;
    res.status(500).json({ error: "internal error" });
});

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
