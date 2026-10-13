/* provenance.js — record where each field came from, and when.
 *
 * This project reads overlapping facts from several agencies and they
 * legitimately disagree. A parcel's area is on LED (ไร่-งาน-ตร.วา) and on
 * กรมที่ดิน (ตร.วา). Its valuation is on LED (assetprice4 — the auction
 * appraisal) and on กรมธนารักย์ (ราคาประเมินทุนทรัพย์). Those are different
 * quantities that look alike, so collapsing them into one column loses
 * information with no trace.
 *
 * Hence every write is recorded per FIELD, per SOURCE, per DAY. Divergences
 * and day-over-day drift then become queries rather than archaeology.
 *
 * Writes are batched: a nightly province run records hundreds of fields, and
 * one round trip per field would dominate the ingest.
 */

export const SOURCE = {
    LED: "led",
    DOL: "dol",
    EVA_AREA: "treasury_eva_area",
    EVA_SHEET: "treasury_eva_sheet",
    DOPA: "dopa",
};

/**
 * Which source is authoritative for which field. Declared once so the ingest
 * cannot accidentally credit the wrong agency — the most likely bug here is a
 * value arriving from LED and being logged as กรมธนารักย์, or vice versa.
 */
export const FIELD_SOURCE = {
    // LED — the auction listing itself
    deed_number: SOURCE.LED,
    land_title: SOURCE.LED,
    land_title_raw: SOURCE.LED,
    tumbol: SOURCE.LED,
    district_name: SOURCE.LED,
    province_name: SOURCE.LED,
    case_no: SOURCE.LED,
    case_year: SOURCE.LED,
    court: SOURCE.LED,
    plaintiff: SOURCE.LED,
    defendant: SOURCE.LED,
    owner: SOURCE.LED,
    asset_type: SOURCE.LED,
    size_rai: SOURCE.LED,
    size_ngan: SOURCE.LED,
    size_wa: SOURCE.LED,
    start_price: SOURCE.LED,
    committee_price: SOURCE.LED,
    led_price: SOURCE.LED,
    officer_price: SOURCE.LED,
    expert_price: SOURCE.LED,
    bid_security: SOURCE.LED,
    published_date: SOURCE.LED,
    next_round_date: SOURCE.LED,
    status: SOURCE.LED,
    close_reason: SOURCE.LED,

    // กรมธนารักย์ — valuation, keyed by tambon
    eva_price_min: SOURCE.EVA_AREA,
    eva_price_max: SOURCE.EVA_AREA,
    eva_price_avg: SOURCE.EVA_AREA,
    eva_grade_count: SOURCE.EVA_AREA,
    tambon_code: SOURCE.EVA_AREA,

    // กรมที่ดิน — authoritative for the parcel itself
    dol_lat: SOURCE.DOL,
    dol_lon: SOURCE.DOL,
    dol_land_price: SOURCE.DOL,
    dol_rai: SOURCE.DOL,
    dol_ngan: SOURCE.DOL,
    dol_wa: SOURCE.DOL,
    dol_land_type: SOURCE.DOL,
    dol_office: SOURCE.DOL,
};

const numish = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

export class ProvenanceRecorder {
    /**
     * @param {import('pg').Client} client
     * @param {{runId?: number|null, flushEvery?: number}} opts
     */
    constructor(client, { runId = null, flushEvery = 500 } = {}) {
        this.client = client;
        this.runId = runId;
        this.flushEvery = flushEvery;
        this.rows = [];
        this.count = 0;
    }

    /** Credit a field to the source declared for it in FIELD_SOURCE. */
    record(entityType, entityId, field, value, { source, entity, force } = {}) {
        if (value === null || value === undefined || value === "") return false;
        const src = source ?? FIELD_SOURCE[field];
        if (!src) {
            throw new Error(`provenance: no source declared for field "${field}" — add it to FIELD_SOURCE`);
        }
        const n = numish(value);
        this.rows.push([
            entityType, entityId, field, src,
            typeof value === "string" ? value : null,
            n,
        ]);
        this.count++;
        if (this.rows.length >= this.flushEvery) return this.flush();
        return true;
    }

    /** Record a whole lot of field->value pairs against one entity. */
    recordFields(entityType, entityId, fields, opts = {}) {
        let any = false;
        for (const [k, v] of Object.entries(fields)) {
            if (this.record(entityType, entityId, k, v, opts)) any = true;
        }
        return any;
    }

    /**
     * Write the batch. Re-recording the same (entity, field, source) on the
     * same day overwrites rather than duplicating, so a nightly re-scrape stays
     * cheap while the daily history is preserved.
     */
    async flush() {
        if (!this.rows.length) return 0;
        const batch = this.rows.splice(0, this.rows.length);
        const values = [];
        const params = [];
        for (const [et, ei, fn, sk, vt, vn] of batch) {
            const b = params.length;
            // (entity_type, entity_id, field_name, source_key,
            //  observed_on, value_num, value_text, run_id)
            params.push(et, ei, fn, sk, vn, vt, this.runId);
            values.push(
                `($${b + 1},$${b + 2},$${b + 3},$${b + 4},CURRENT_DATE,$${b + 5},$${b + 6},$${b + 7})`,
            );
        }
        await this.client.query(
            `INSERT INTO field_provenance
               (entity_type, entity_id, field_name, source_key,
                observed_on, value_num, value_text, run_id)
             VALUES ${values.join(",")}
             ON CONFLICT (entity_type, entity_id, field_name, source_key, observed_on)
             DO UPDATE SET value_num = EXCLUDED.value_num,
                           value_text = EXCLUDED.value_text,
                           observed_at = now(),
                           run_id = EXCLUDED.run_id`,
            params,
        );
        return batch.length;
    }

    /** Registered/refreshed sources, so last_used stays meaningful. */
    async touchSources(keys) {
        if (!keys?.length) return;
        await this.client.query(
            `UPDATE data_sources SET last_used = now() WHERE key = ANY($1)`,
            [keys],
        );
    }
}

/**
 * Area comparison used to decide `geo_status`.
 *
 * LED publishes ไร่/งาน/ตร.วา; กรมที่ดิน publishes ตร.วา. 1 ไร่ = 400 ตร.วา,
 * 1 งาน = 100 ตร.วา. Condo lots are ตร.ม. on both sides and must never be
 * compared this way — NOTES §17 recorded 5 of 30 same-number hits being a
 * different property, driven by exactly this confusion.
 */
export function raiNganWaToSqWa(rai, ngan, wa) {
    const r = numish(rai) ?? 0;
    const n = numish(ngan) ?? 0;
    const w = numish(wa) ?? 0;
    if (r === 0 && n === 0 && w === 0) return null;
    return r * 400 + n * 100 + w;
}

/**
 * @returns {'match'|'mismatch'|'unknown'}
 */
export function compareArea(ledSizeSqWa, dolAreaSqWa, { tolerancePct = 5 } = {}) {
    const a = numish(ledSizeSqWa);
    const b = numish(dolAreaSqWa);
    if (a === null || b === null || a <= 0 || b <= 0) return "unknown";
    const diff = Math.abs(a - b);
    if (diff <= Math.max(1, (a * tolerancePct) / 100)) return "match";
    return "mismatch";
}
