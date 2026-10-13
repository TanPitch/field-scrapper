/* tambonResolver.js — map LED's subdistrict NAME to its กรมการปกครอง code.
 *
 * Why a resolver is needed: eva_area_grade is keyed on
 * (changwat_code, amphur_code, tambon_code) but LED publishes only names for
 * province/amphur/tambon. Province and amphur already resolve through
 * provinceParser/amphurParser (verified to use identical codes). Tambon does
 * not, so this builds the missing dictionary from eva_area_grade itself —
 * which carries changwat_name/amphur_name/tambon_name alongside the codes, so
 * no external dataset is required.
 *
 * Two wrinkles this handles:
 *
 *   1. PREFIX. 2467 of 7915 official names carry an "เทศบาล" prefix
 *      ("เทศบาลตำบลภูเวียง") while LED writes the bare name ("ภูเวียง").
 *      Both forms are indexed; the bare name is preferred because it is the
 *      real administrative tambon and code 99 rows are usually the
 *      municipality re-statement of a tambon that already has its own code.
 *
 *   2. AMBIGUITY. The same tambon name can appear under two amphur codes in
 *      one province (verified: โนนสะอาด appears under both 40/04 and 40/13).
 *      Scoping the dictionary to (province, amphur) keeps those apart; a name
 *      that is still ambiguous inside that scope is reported as such rather
 *      than guessed.
 *
 * Coverage: 7915 of Thailand's 8741 tambons appear in eva_area_grade (90.5%).
 * The remainder are reported as unresolved rather than defaulted.
 */

/** Strip the municipal prefixes กรมธนารักย์ uses but LED omits. */
export function normalizeTambon(name) {
    if (name == null) return "";
    return String(name)
        .replace(/\s+/g, "")
        // เทศบาลตำบล / เทศบาลนคร / เทศบาลเมือง / เทศบาล / อบต.
        .replace(/^(เทศบาล(?:ตำบล|นคร|เมือง)?|อบต\.)/, "")
        .trim();
}

/** LED occasionally appends a sub-area or parenthetical qualifier. */
export function stripQualifier(name) {
    return normalizeTambon(name)
        .replace(/\(.*?\)/g, "")
        .replace(/\s+/g, "")
        .trim();
}

export class TambonResolver {
    constructor(rows = []) {
        // key: `${province}|${amphur}` -> { byExact, byBare, byStem }
        this.scope = new Map();
        for (const r of rows) this.add(r);
    }

    add(row) {
        const { changwat_code: pc, amphur_code: ac, tambon_code: tc, tambon_name: tn } = row;
        if (!pc || !ac || !tc || !tn) return;
        const key = `${pc}|${ac}`;
        let bucket = this.scope.get(key);
        if (!bucket) {
            bucket = { byExact: new Map(), byBare: new Map(), byStem: new Map() };
            this.scope.set(key, bucket);
        }
        const rec = { code: String(tc).trim(), name: String(tn).trim(), province: String(pc).trim(), amphur: String(ac).trim() };
        const exact = normalizeTambon(tn);
        const bare = stripQualifier(tn);
        if (!bucket.byExact.has(exact)) bucket.byExact.set(exact, []);
        bucket.byExact.get(exact).push(rec);
        if (!bucket.byBare.has(bare)) bucket.byBare.set(bare, []);
        bucket.byBare.get(bare).push(rec);
    }

    /**
     * @returns {{code:string,name:string,match:'exact'|'prefix'|'stem'|'ambiguous'}|null}
     */
    resolve(provinceCode, amphurCode, tambonName) {
        if (provinceCode == null || amphurCode == null || !tambonName) return null;
        const bucket = this.scope.get(`${provinceCode}|${amphurCode}`);
        if (!bucket) return null;

        const exactKey = normalizeTambon(tambonName);
        if (bucket.byExact.has(exactKey)) {
            const recs = dedupeCodes(bucket.byExact.get(exactKey));
            if (recs.length === 1) return { ...recs[0], match: "exact" };
            if (recs.length > 1) return preferRealTambon(recs, "ambiguous");
        }

        const bareKey = stripQualifier(tambonName);
        if (bucket.byBare.has(bareKey)) {
            const recs = dedupeCodes(bucket.byBare.get(bareKey));
            if (recs.length === 1) return { ...recs[0], match: "prefix" };
            if (recs.length > 1) return preferRealTambon(recs, "ambiguous");
        }

        // Last resort: the LED string carries a qualifier the official name
        // does not, e.g. "บ้านดุง (บางสะแก)". Match on the longer stem only
        // when it is unambiguous inside the amphur.
        const stem = bareKey.replace(/[^\p{L}\p{N}]/gu, "");
        if (stem.length >= 3) {
            for (const [k, recs] of bucket.byStem) {
                if (k.includes(stem) || stem.includes(k)) {
                    const d = dedupeCodes(recs);
                    if (d.length === 1) return { ...d[0], match: "stem" };
                }
            }
        }
        return null;
    }

    /** Build the stem index after construction; kept separate so `add` stays cheap. */
    indexStems() {
        for (const bucket of this.scope.values()) {
            for (const [k, recs] of bucket.byBare) {
                const stem = k.replace(/[^\p{L}\p{N}]/gu, "");
                if (stem.length < 3) continue;
                if (!bucket.byStem.has(stem)) bucket.byStem.set(stem, []);
                bucket.byStem.get(stem).push(...recs);
            }
        }
        return this;
    }

    get size() {
        return this.scope.size;
    }
}

function dedupeCodes(recs) {
    const seen = new Map();
    for (const r of recs) if (!seen.has(r.code)) seen.set(r.code, r);
    return [...seen.values()];
}

/**
 * Code 99 is the municipality's own re-statement of a tambon that normally has
 * a real code, so prefer the non-99 record. Still ambiguous after that?
 * Report ambiguity instead of guessing.
 */
function preferRealTambon(recs, fallbackMatch) {
    const real = recs.filter((r) => r.code !== "99");
    if (real.length === 1) return { ...real[0], match: fallbackMatch === "ambiguous" ? "ambiguous" : fallbackMatch };
    if (real.length === 0) return { ...recs[0], match: fallbackMatch };
    return { ...recs[0], match: "ambiguous" };
}

/** Load the dictionary from eva_area_grade via any pg client. */
export async function loadTambonResolver(client) {
    const { rows } = await client.query(
        `SELECT DISTINCT changwat_code, amphur_code, tambon_code, tambon_name
           FROM eva_area_grade`,
    );
    return new TambonResolver(rows).indexStems();
}

/** Appraisal bracket for a resolved tambon, or null when unpriced. */
export async function loadAreaGrades(client) {
    const { rows } = await client.query(
        `SELECT changwat_code, amphur_code, tambon_code,
                min(evaprice) AS eva_price_min,
                max(evaprice) AS eva_price_max,
                round(avg(evaprice), 2) AS eva_price_avg,
                count(*)     AS eva_grade_count
           FROM eva_area_grade
          GROUP BY 1,2,3`,
    );
    const m = new Map();
    for (const r of rows) {
        m.set(`${r.changwat_code}|${r.amphur_code}|${r.tambon_code}`, {
            min: r.eva_price_min === null ? null : Number(r.eva_price_min),
            max: r.eva_price_max === null ? null : Number(r.eva_price_max),
            avg: r.eva_price_avg === null ? null : Number(r.eva_price_avg),
            count: Number(r.eva_grade_count),
        });
    }
    return m;
}
