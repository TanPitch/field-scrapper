/* ingest.js — write scraped LED lots into PostgreSQL.
 *
 * The single writer. Bots queue, this owns the DB (agreed architecture).
 *
 * Two rules drive the whole design:
 *
 *  1. IDEMPOTENT. Re-ingesting the same lot must be a no-op, not a duplicate.
 *     The natural key `(parcel, case_no, case_year, order_number, order_sub,
 *     first_round_date)` is what makes a re-list a NEW row and a re-scrape the
 *     SAME row.
 *
 *  2. IMAGES ARE NOT RE-FETCHED. A lot keeps its photo set for its whole life,
 *     so images are only downloaded for lots we have never seen. That is what
 *     keeps a nightly re-scrape at zero image requests (imageStore.js).
 *
 *   DATABASE_URL=postgres://user:pass@host/db node ingest.js rows.json
 */
import pg from "pg";
import { LocalImageStore, planImageBudget } from "./imageStore.js";
import { loadTambonResolver, loadAreaGrades } from "./tambonResolver.js";
import { ProvenanceRecorder, SOURCE } from "./provenance.js";
import { parseGroupSaleRemark } from "./groupSale.js";

const { Client } = pg;

/* ---------------------------------------------------------------- helpers */

const num = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const s = String(v).replace(/,/g, "").trim();
    if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
};
const int = (v) => {
    const n = num(v);
    return n === null ? null : Math.trunc(n);
};
const txt = (v) => {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s === "" ? null : s;
};
/** LED writes "25690713" for a Buddhist-era date. */
const thDate = (v) => {
    const s = txt(v);
    if (!s || !/^\d{8}$/.test(s)) return null;
    const y = Number(s.slice(0, 4));
    const m = Number(s.slice(4, 6));
    const d = Number(s.slice(6, 8));
    if (!m || !d) return null;
    const iso = `${y - 543}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    return Number.isNaN(Date.parse(iso)) ? null : iso;
};
const isoDate = (v) => {
    const s = txt(v);
    if (!s) return null;
    return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : null;
};
/**
 * Land title (ชนิดโฉนด), tolerant of older dumps.
 *
 * LED's spellings vary and `land_title_raw` is only present on recent scrapes,
 * so fall back to the pre-rename `address.type`. Unrecognised values pass
 * through rather than becoming null, so a new spelling is visible in the DB
 * instead of silently looking like missing data.
 */
const TITLE_RULES = [
    [/^ตามสำเนา/, "ตามสำเนาโฉนด"],
    [/^น\.?ส\.?3ก/, "น.ส.3ก."],
    [/^โฉนด/, "โฉนด"],
    [/^หนือกรรมสิทธิ์/, "โฉนด"],
];
function titleOf(address = {}) {
    const raw = txt(address.land_title_raw) ?? txt(address.land_title) ?? txt(address.type);
    if (!raw) return { code: null, raw: null };
    const squeezed = raw.replace(/\s+/g, "");
    for (const [re, code] of TITLE_RULES) {
        if (re.test(squeezed)) return { code, raw };
    }
    return { code: raw, raw };
}
const isCondo = (assetType) => /ห้องชุด/.test(txt(assetType) ?? "");

/* ------------------------------------------------------------- reference */

/**
 * LED and the Treasury (กรมพัฒนาการเกษตร/กรมที่ดิน) province registries agree on
 * every province except one: บึงกาฬ is LED 97 but TD 38. Copying `code` into
 * `dol_code` - which is what the old ensureProvince did - silently mislabels it,
 * so the divergence is stated here rather than inherited.
 *
 * TD does publish subdistricts, but LED does not: get_tambon.asp returns a
 * postcode rather than a numeric tambon id, and that postcode repeats. So a
 * district carries LED's 4-digit `code` and `dol_code` (its 2-digit suffix),
 * while a subdistrict carries three columns, one per numbering system.
 */
const PROVINCE_DOL_CODE = { 97: 38 };

async function ensureProvince(client, code, name) {
    if (!int(code)) return null;
    const dol = PROVINCE_DOL_CODE[int(code)] ?? int(code);
    const r = await client.query(
        `INSERT INTO provinces (code, name, dol_code) VALUES ($1, $2, $3)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, dol_code = EXCLUDED.dol_code
         RETURNING code`,
        [int(code), txt(name) ?? String(code), dol],
    );
    return r.rows[0].code;
}

async function ensureDistrict(client, provinceCode, dolCode, name) {
    if (!int(provinceCode) || !int(dolCode)) return null;
    const r = await client.query(
        `INSERT INTO districts (province_id, code, dol_code, name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (province_id, dol_code) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [int(provinceCode), int(provinceCode) * 100 + int(dolCode), int(dolCode), txt(name) ?? String(dolCode)],
    );
    return r.rows[0].id;
}

/**
 * Subdistricts are discovered the same lazy way as provinces and districts:
 * LED gives us a tambon NAME, and the กรมการปกครอง code is only known after
 * the tambon has been resolved against eva_area_grade.
 *
 * That eva code lands in `eva_code`, not `code`. `code` used to hold it, but the
 * column also has to carry LED's own tambon identifier, and LED does not publish
 * a numeric one - get_tambon.asp returns a postcode, which repeats freely
 * (83000 stands in for "no postcode" across five Phuket tambons). One column
 * cannot hold a duplicate-prone postcode and a unique eva code, so they are
 * separate: led_code, eva_code, dol_code.
 *
 * eva codes are unique WITHIN a district but repeat across districts
 * (หนองไผ่=93 in ชุมแพ and บ้านค้อ=93 in เมืองขอนแก่น are different tambons), so
 * the unique index is on (district_id, eva_code).
 *
 * That makes the code the authority inside a district. LED's tambon name and
 * the reference table's name for the same tambon are not always byte-identical,
 * and a plain INSERT of a spelling variant with an already-claimed code died on
 * a unique violation, taking down the whole province ingest. So: known name wins,
 * then known code wins, and only a genuinely new pair inserts.
 */
async function ensureSubdistrict(client, districtId, name, code) {
    if (!districtId || !txt(name)) return null;
    const nm = txt(name);

    const byName = await client.query(
        `SELECT id FROM subdistricts WHERE district_id = $1 AND name = $2 LIMIT 1`,
        [districtId, nm],
    );
    if (byName.rows[0]) return byName.rows[0].id;

    if (txt(code)) {
        const byCode = await client.query(
            `SELECT id, name FROM subdistricts WHERE district_id = $1 AND eva_code = $2 LIMIT 1`,
            [districtId, txt(code)],
        );
        if (byCode.rows[0]) {
            console.warn(`    [tambon] code ${code} in district ${districtId} already held by "${byCode.rows[0].name}"; reusing it for "${nm}"`);
            return byCode.rows[0].id;
        }
    }

    const r = await client.query(
        `INSERT INTO subdistricts (district_id, name, eva_code)
         VALUES ($1, $2, $3)
         ON CONFLICT (district_id, name) DO NOTHING
         RETURNING id`,
        [districtId, nm, txt(code)],
    );
    return r.rows[0]?.id ?? null;
}

/**
 * Area-level valuation for a lot, resolved from its tambon.
 *
 * Returns nulls when the tambon is unresolved so that `eva_price_at` stays
 * NULL and the lot keeps showing up in parcels_eva_pending_idx — an unresolved
 * lot is a visible gap, not a silently zero-priced one.
 */
async function areaValuation(ctx, provinceCode, amphurDolCode, tambonName) {
    if (!ctx.tambonResolver || !ctx.areaGrades) return null;
    const hit = ctx.tambonResolver.resolve(provinceCode, amphurDolCode, tambonName);
    if (!hit) return null;
    const grade = ctx.areaGrades.get(`${provinceCode}|${amphurDolCode}|${hit.code}`);
    return { tambon: hit, grade: grade ?? null };
}

/* --------------------------------------------------------------- parcels */

/** One auction row can list several deeds; each becomes its own parcel. */
async function upsertParcels(client, lot, provinceCode, dolCode, stats, ctx) {
    const a = lot.address ?? {};
    const deeds = a.deeds ?? {};
    const out = [];
    const condo = isCondo(lot.type);

    /* parcels.district_dol_code is the 2-digit กรมที่ดิน code, NOT the internal
       districts.id and NOT LED's 4-digit code. The scraper carries only the
       amphur NAME, so the code must be resolved through the reference table —
       passing the id here silently produced NULL.
       Note districts.province_id is an FK to provinces.**code**, not
       provinces.id (001_core.sql). The column name is misleading: joining it to
       provinces.id reports every district as orphaned. districts.code is the
       4-digit LED amphurId (provinceCode + dolCode), also not the internal id. */
    const district = await client.query(
        `SELECT id, dol_code FROM districts WHERE province_id = $1 AND name = $2 LIMIT 1`,
        [provinceCode, txt(a.amphur)],
    );
    const effectiveDol = int(dolCode) ?? (district.rows[0] ? district.rows[0].dol_code : null);
    if (effectiveDol === null) {
        stats.skippedNoDistrict++;
        return out;
    }
    const districtId = district.rows[0]?.id ?? null;

    /* Area-level appraisal: resolve the tambon name to its official code, then
       read the bracket. Cheap and offline, so a lot gets a price range on the
       same pass that creates it — no DOL call involved. */
    const valuation = await areaValuation(ctx, provinceCode, effectiveDol, txt(a.tumbol));
    if (valuation?.tambon) {
        stats.tambonResolved++;
        if (valuation.grade) stats.areaValued++;
        await ensureSubdistrict(client, districtId, txt(a.tumbol), valuation.tambon.code);
    } else {
        stats.tambonUnresolved++;
    }

    for (const part of deeds.parts ?? []) {
        for (const deed of part.numbers ?? []) {
            const title = titleOf(a);
            const r = await client.query(
                `INSERT INTO parcels
                   (province_code, district_dol_code, deed_number, land_title, land_title_raw,
                    tumbol, district_name, province_name, geo_status, geo_note, last_seen,
                    tambon_code, tambon_match,
                    eva_price_min, eva_price_max, eva_price_avg, eva_grade_count,
                    eva_price_source, eva_price_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'unresolved',$9, now(),
                         $10,$11,$12,$13,$14,$15,$16,$17)
                 ON CONFLICT (province_code, district_dol_code, deed_number)
                 DO UPDATE SET last_seen = now(),
                               land_title = COALESCE(EXCLUDED.land_title, parcels.land_title),
                               land_title_raw = COALESCE(EXCLUDED.land_title_raw, parcels.land_title_raw),
                               tumbol    = COALESCE(EXCLUDED.tumbol, parcels.tumbol),
                               district_name = COALESCE(EXCLUDED.district_name, parcels.district_name),
                               tambon_code   = COALESCE(EXCLUDED.tambon_code, parcels.tambon_code),
                               tambon_match  = COALESCE(EXCLUDED.tambon_match, parcels.tambon_match),
                               eva_price_min = COALESCE(EXCLUDED.eva_price_min, parcels.eva_price_min),
                               eva_price_max = COALESCE(EXCLUDED.eva_price_max, parcels.eva_price_max),
                               eva_price_avg = COALESCE(EXCLUDED.eva_price_avg, parcels.eva_price_avg),
                               eva_grade_count = COALESCE(EXCLUDED.eva_grade_count, parcels.eva_grade_count),
                               eva_price_source = COALESCE(EXCLUDED.eva_price_source, parcels.eva_price_source),
                               eva_price_at = COALESCE(EXCLUDED.eva_price_at, parcels.eva_price_at)
                 RETURNING id, (xmax = 0) AS inserted`,
                [
                    provinceCode, effectiveDol, String(deed),
                    title.code, title.raw,
                    txt(a.tumbol), txt(a.amphur), txt(a.city),
                    condo ? "condo unit number is not a land parcel number" : null,
                    valuation?.tambon?.code ?? null,
                    valuation?.tambon?.match ?? null,
                    valuation?.grade?.min ?? null,
                    valuation?.grade?.max ?? null,
                    valuation?.grade?.avg ?? null,
                    valuation?.grade?.count ?? null,
                    valuation?.grade ? "eva_area_grade" : null,
                    valuation?.grade ? new Date() : null,
                ],
            );
            if (r.rows[0].inserted) stats.parcelsNew++;
            out.push({ id: r.rows[0].id, valuation, title, tumbol: txt(a.tumbol) });
        }
    }
    return out;
}

/* ------------------------------------------------------------------ lots */

const LOT_COLUMNS = `
    parcel_id, case_no, case_year, court, plaintiff, defendant, owner, department,
    first_round_date, order_number, order_sub, order_label, asset_type,
    size_unit, size_rai, size_ngan, size_wa, published_date, legal_exec_dept, remark,
    start_price, start_price_src, committee_price, led_price, officer_price,
    expert_price, bid_security, status, close_code, close_reason, closed_at,
    next_round_date, next_round_price, deed_number, plot_no,
    group_lot_count, group_total_price, last_seen`;

/* Columns refreshed on conflict. Written out rather than derived by parsing
   LOT_COLUMNS — deriving it produced a trailing comma and a syntax error, and a
   silent mismatch here would overwrite good data with bad. */
const LOT_UPSERT_COLUMNS = [
    "case_no", "case_year", "court", "plaintiff", "defendant", "owner", "department",
    "order_number", "order_sub", "order_label", "asset_type",
    "size_unit", "size_rai", "size_ngan", "size_wa", "published_date", "legal_exec_dept",
    "remark", "start_price", "start_price_src", "committee_price", "led_price",
    "officer_price", "expert_price", "bid_security", "status", "close_code",
    "close_reason", "closed_at", "next_round_date", "next_round_price",
    "deed_number", "plot_no", "group_lot_count", "group_total_price", "last_seen",
];

async function upsertLot(client, lot, parcelId, stats) {
    const p = lot.bid?.price ?? {};
    const a = lot.address ?? {};
    const life = lot.lifecycle ?? {};
    const rounds = lot.bid?.rounds ?? [];

    const firstRound = rounds.find((r) => r.date)?.date ?? null;
    if (!firstRound) {
        stats.skippedNoRound++;
        return null;
    }

    const condo = isCondo(lot.type);
    const sz = lot.size ?? {};
    const group = parseGroupSaleRemark(lot.remark);

    const values = [
        parcelId, txt(lot.case_no?.number), int(lot.case_no?.year), txt(lot.court),
        txt(lot.plaintiff), txt(lot.defendant), txt(lot.owner), txt(lot.legal_execution_department),
        firstRound, int(lot.order?.number), int(lot.order?.sub_number), txt(lot.order?.combined),
        txt(lot.type),
        condo ? "sqm" : "wa", num(sz.rai), num(sz.ngan), num(sz.wa),
        isoDate(lot.published_date), txt(lot.legal_execution_department), txt(lot.remark),
        num(lot.start_price ?? p.start_price), txt(p.start_price_source),
        num(p.committee_appraisal_price), num(p.led_appraisal_price),
        num(p.officer_appraisal_price), num(p.expert_appraisal_price), num(p.bid_security),
        life.status ?? "active", int(life.close_code), txt(life.close_reason),
        life.status === "closed" ? new Date().toISOString() : null,
        isoDate(life.next_round?.date), num(life.next_round?.price),
        /* LED facts, stored on the lot rather than only reached through the
           parcel. For a condominium listing the deed number is the building and
           addr_no is the unit, so it is the pair that identifies the asset. */
        txt(a.number ?? a.deeds?.numbers?.[0]), txt(a.addr_no),
        /* Group-sale note, when present. Both numbers are LED's, kept so the
           row can be checked against what actually landed — see groupSale.js.
           Null for a lot sold on its own. */
        group?.lotCount ?? null, group?.totalPrice ?? null,
        new Date(),
    ];

    const setClause = LOT_UPSERT_COLUMNS.map((c) => `${c} = EXCLUDED.${c}`).join(", ");

    const r = await client.query(
        `INSERT INTO auction_lots (${LOT_COLUMNS})
         VALUES (${values.map((_, i) => `$${i + 1}`).join(",")})
         /* Must match lots_natural_key exactly. parcel_id is deliberately NOT
            in it: it is only populated once the TD/DOL match succeeds, so for
            an unmatched province it is NULL for every lot and the key
            degenerates to case + order, collapsing a whole bankruptcy order
            into one row. The deed and plot are LED facts, always present, and
            are what actually tell two lots apart. */
         ON CONFLICT (case_no, case_year,
                      coalesce(order_number, -1), coalesce(order_sub, -1),
                      coalesce(deed_number, ''), coalesce(plot_no, ''),
                      first_round_date)
         DO UPDATE SET ${setClause}
         RETURNING id, (xmax = 0) AS inserted`,
        values,
    );

    const { id, inserted } = r.rows[0];
    if (inserted) stats.lotsNew++;
    else stats.lotsUpdated++;
    return id;
}

async function upsertRounds(client, lotId, lot) {
    const rounds = lot.bid?.rounds ?? [];
    for (const r of rounds) {
        if (r.statusCode === null && !r.date) continue;
        await client.query(
            `INSERT INTO auction_rounds
               (lot_id, idx, round_date, status_code, status_label, is_held, discount_pct, price, scraped_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
             ON CONFLICT (lot_id, idx) DO UPDATE SET
               round_date   = EXCLUDED.round_date,
               status_code  = EXCLUDED.status_code,
               status_label = EXCLUDED.status_label,
               is_held      = EXCLUDED.is_held,
               discount_pct = EXCLUDED.discount_pct,
               price        = EXCLUDED.price,
               scraped_at   = now()`,
            [lotId, r.idx, isoDate(r.date), int(r.statusCode), txt(r.status_label),
             Boolean(r.is_held), int(r.discount_pct ?? 0), num(r.price)],
        );
    }
}

/* ---------------------------------------------------------------- public */
export async function ingest(lots, { client, imageStore = null, imageBudget = 300, runId = null } = {}) {
    const stats = {
        parcelsNew: 0, lotsNew: 0, lotsUpdated: 0, skippedNoRound: 0,
        skippedNoDistrict: 0, skippedNoProvince: 0,
        tambonResolved: 0, tambonUnresolved: 0, areaValued: 0,
        images: null, rounds: 0,
    };
    const newLots = [];

    /* Provenance recorder. One per ingest; batches writes so a nightly province
       run does not issue a query per field. */
    const prov = new ProvenanceRecorder(client);

    /* Reference data for valuation. Absent when migration 002 has not been run
       or the tables are empty — valuation is then simply skipped, so ingest
       still works on a core-only database. */
    const ctx = { tambonResolver: null, areaGrades: null };
    try {
        ctx.areaGrades = await loadAreaGrades(client);
        ctx.tambonResolver = await loadTambonResolver(client);
        stats.valuationScopes = ctx.tambonResolver.size;
        stats.valuationTambons = ctx.areaGrades.size;
    } catch (e) {
        stats.valuationScopes = 0;
        stats.valuationTambons = 0;
        console.warn(`  ! area valuation unavailable: ${e.message}`);
    }

    /* LED gives only the amphur NAME, so the 2-digit กรมที่ดิน code comes from
       amphurParser(). The same dictionary resolves the PROVINCE code from its
       name: `address.province_id` on a row is a per-row value that is empty on
       most lots, and trusting it produced six bogus provinces named ขอนแก่น
       with codes 20/21/22/23/24/401. Resolve from the name instead. */
    let parsers = { provinceParser: null, amphurParser: null };
    try {
        parsers = await import("./scrapeLand.js");
    } catch {
        console.warn("  ! scrapeLand.js unavailable — codes must be supplied on the row");
    }

    const provinceOf = (lot) => {
        const a = lot.address ?? {};
        const fromName = parsers.provinceParser?.(a.city);
        return int(fromName) ?? int(a.province_id) ?? int(a.province_code);
    };
    const districtOf = (lot) => {
        const a = lot.address ?? {};
        return int(a.dol_code) ?? int(parsers.amphurParser?.(a.amphur, a.city));
    };

    /* Seed reference data once, so the dol_code lookup has something to resolve
       against. */
    for (const lot of lots) {
        const pc = provinceOf(lot);
        if (pc === null) continue;
        const code = await ensureProvince(client, pc, lot.address?.city);
        await ensureDistrict(client, code, districtOf(lot), lot.address?.amphur);
    }

    for (const lot of lots) {
        const provinceCode = provinceOf(lot);
        if (provinceCode === null) {
            stats.skippedNoProvince++;
            continue;
        }
        const name = await ensureProvince(client, provinceCode, lot.address?.city);

        const parcels = await upsertParcels(client, lot, name, districtOf(lot), stats, ctx);
        if (!parcels.length) continue;

        for (const parcel of parcels) {
            const lotId = await upsertLot(client, lot, parcel.id, stats);
            if (!lotId) continue;
            await upsertRounds(client, lotId, lot);
            stats.rounds += (lot.bid?.rounds ?? []).filter((r) => r.statusCode !== null || r.date).length;
            newLots.push({ ...lot, parcelId: parcel.id, lotId });

            /* Provenance: which agency supplied which field. The source is
               looked up from FIELD_SOURCE rather than passed at each call site,
               so a กรมธนารักย์ valuation cannot be silently logged as coming
               from LED (or vice versa). */
            prov.recordFields("parcel", parcel.id, {
                deed_number: parcel.id ? lot.address?.deeds?.numbers?.[0] : null,
                land_title: parcel.title?.code,
                land_title_raw: parcel.title?.raw,
                tumbol: parcel.tumbol,
                district_name: lot.address?.amphur,
                province_name: lot.address?.city,
                eva_price_min: parcel.valuation?.grade?.min,
                eva_price_max: parcel.valuation?.grade?.max,
                eva_price_avg: parcel.valuation?.grade?.avg,
                eva_grade_count: parcel.valuation?.grade?.count,
                tambon_code: parcel.valuation?.tambon?.code,
            });
            const p = lot.bid?.price ?? {};
            prov.recordFields("auction_lot", lotId, {
                case_no: lot.case_no?.number,
                case_year: lot.case_no?.year,
                court: lot.court,
                plaintiff: lot.plaintiff,
                defendant: lot.defendant,
                owner: lot.owner,
                asset_type: lot.type,
                size_rai: lot.size?.rai,
                size_ngan: lot.size?.ngan,
                size_wa: lot.size?.wa,
                start_price: lot.start_price ?? p.start_price,
                committee_price: p.committee_appraisal_price,
                led_price: p.led_appraisal_price,
                officer_price: p.officer_appraisal_price,
                expert_price: p.expert_appraisal_price,
                bid_security: p.bid_security,
                published_date: lot.published_date,
                next_round_date: lot.lifecycle?.next_round?.date,
                status: lot.lifecycle?.status,
                close_reason: lot.lifecycle?.close_reason,
            });
        }
    }

    await prov.flush();
    await prov.touchSources(Object.values(SOURCE));

    /* Images last, and only for lots that are genuinely new. Re-scraping a
       province we already hold must cost zero image requests. */
    if (imageStore && newLots.length) {
        const budget = planImageBudget(newLots, { dailyCap: imageBudget });
        stats.images = await imageStore.fetchAll(newLots);
        stats.images.budget = budget;
        for (const l of newLots) {
            for (const im of l.images ?? []) {
                const url = im.url ?? null;
                if (!url) continue;
                await client.query(
                    `INSERT INTO lot_images (lot_id, kind, url, local_path)
                     VALUES ($1,$2,$3,$4)
                     ON CONFLICT (lot_id, kind) DO UPDATE SET local_path = EXCLUDED.local_path`,
                    [l.lotId, im.kind, url, imageStore.localPathFor(url)],
                );
            }
        }
    }

    return stats;
}

export { LocalImageStore };

// ---- CLI ------------------------------------------------------------------

if (import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1]).href) {
    const fs = await import("fs");
    const { priceRow } = await import("./pricing.js");
    const { beginRun, step, finishRun } = await import("./runs.js");

    const file = process.argv[2] ?? "./out/rows.json";
    const url = process.env.DATABASE_URL;
    if (!url) {
        console.error("DATABASE_URL is required, e.g.");
        console.error("  DATABASE_URL=postgres://postgres:test@localhost:5432/fmtest node ingest.js");
        process.exit(1);
    }

    const lots = JSON.parse(fs.readFileSync(file, "utf8")).map((r) => priceRow(r));
    const client = new Client({ connectionString: url });
    await client.connect();

    // The run row is what makes this pass visible in the app's status page. It
    // is opened before any work and closed even if ingest throws, so a failure
    // shows up as a failed run instead of a permanent "running".
    const provinceCode = Number(process.env.PROVINCE_CODE) || lots[0]?.address?.province_code || null;
    const runId = await beginRun(client, {
        stage: "scrape", provinceCode,
        runKey: process.env.RUN_KEY ?? null,
        notes: `ingest ${file}`,
    });
    await step(client, runId, `ingesting ${lots.length} lots`);

    // SKIP_IMAGES=1 exercises the valuation path without touching LED's CDN.
    const skipImages = process.env.SKIP_IMAGES === "1";
    const store = skipImages
        ? null
        : new LocalImageStore("./data/img", { delayMs: Number(process.env.LED_IMG_DELAY_MS || 1200) });
    const t0 = Date.now();

    let stats;
    try {
        stats = await ingest(lots, { client, imageStore: store, runId });
        await finishRun(client, runId, {
            lotsSeen: lots.length,
            lotsNew: stats.lotsNew,
            pages: null,
            detail: stats,
        });
    } catch (e) {
        await finishRun(client, runId, { error: e, errorCount: 1, lotsSeen: lots.length });
        await client.end();
        throw e;
    }
    await client.end();

    console.log("\n=== ingest result ===");
    for (const [k, v] of Object.entries(stats)) {
        console.log(`  ${k.padEnd(16)} ${typeof v === "object" ? JSON.stringify(v) : v}`);
    }
    console.log(`  elapsed          ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    console.log(`  run              #${runId}`);
}