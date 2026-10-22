/* tdLookup.js — กรมธนารักย์ (assessprice) parcel lookup.
 *
 * Wire format confirmed against a request captured from the live application
 * (not guessed). The decisive details, each of which was wrong in earlier
 * attempts:
 *
 *   POST {host}/ashx/Proxy.ashx?{absolute DataService.svc/DS_TRANSIT URL}
 *   Content-Type: application/x-www-form-urlencoded; charset=UTF-8
 *   body        : a JSON string (not a flat form!)
 *
 *   and the parameter names are PROV_CODE / DOL_CODE / AMPH_CODE / TUMB_CODE
 *   — NOT CHANGWAT_CODE / AMPHUR_CODE. Sending the wrong names meant every
 *   filter was silently ignored, which is why even an unfiltered query came
 *   back with zero rows instead of an error.
 *
 *   Also required: FN_ID="GIS5-WF01", PERIODS=7, and the S_KEY cookie set to
 *   the deed number being looked up.
 *
 * Conduct: one session for the whole run, sequential, paced. No concurrency.
 */
import axios from "axios";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36";
const HOST = "https://assessprice.treasury.go.th/assessprice";
const ENDPOINT = `${HOST}/ashx/Proxy.ashx?${HOST}/services/DataService.svc/DS_TRANSIT`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** รอบบัญชีประเมิน — 7 is the current period in the captured request. */
export const PERIOD = 7;
export const FN_ID = "GIS5-WF01";

export async function createTdLookup({ delayMs = 700, log = () => {} } = {}) {
    const jar = new Map();

    const remember = (r) => {
        const sc = r.headers?.["set-cookie"];
        if (!sc) return;
        for (const c of Array.isArray(sc) ? sc : [sc]) {
            const [pair] = c.split(";");
            const i = pair.indexOf("=");
            if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
        }
    };
    const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

    const base = () => ({
        timeout: 40000,
        validateStatus: () => true,
        headers: {
            "User-Agent": UA,
            Accept: "application/json, text/javascript, */*; q=0.01",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            Origin: "https://assessprice.treasury.go.th",
            Referer: "https://assessprice.treasury.go.th/assessprice/",
            "X-Requested-With": "XMLHttpRequest",
            Cookie: cookieHeader(),
        },
    });

    // --- establish session -------------------------------------------------
    const home = await axios.get("https://assessprice.treasury.go.th/assessprice/",
        { ...base(), maxRedirects: 4, headers: { ...base().headers, "Content-Type": undefined } });
    remember(home);

    const csrf = jar.get("CSRF_TOKEN");
    log(`session: ${[...jar.keys()].slice(0, 6).join(", ") || "(no cookies)"}`);
    if (!csrf) log("WARNING: no CSRF_TOKEN cookie — the app issues one per session");
    else log(`CSRF_TOKEN ok (${csrf.length} chars)`);

    let calls = 0;

    /**
     * @param {{deed_number:string, province_code:number|string}} parcel
     * @returns {Promise<object>} normalised result
     */
    /**
     * Post any body to the service with this session.
     *
     * The parcel search answers with a rate and no area, and the map on the site
     * does show the size, so the area has to come from somewhere else - another
     * stored procedure, another search key, or the map identification. Asking
     * those questions needs the session, and a plain post without one gets a stub
     * back: the office name and a phone number, and nothing else.
     */
    const post = async (params) => {
        const body = {
            PERIODS: PERIOD,
            LANGUAGE: "TH",
            USER_ID: "2",
            DEVICE_TYPE: "desktop",
            OS: "Windows",
            COUNTRY: null,
            VISITOR_UUID: jar.get("VISITOR_UUID") ?? "b104bccbd4f1c6c3b2c05dad3a929eb6",
            CSRF_TOKEN: csrf ?? "",
            BEGIN: 1,
            END: 200,
            ...params,
        };
        const r = await axios.post(
            `${ENDPOINT}?&request.preventCache=${Date.now()}`,
            JSON.stringify(body),
            base(),
        );
        remember(r);
        calls++;
        const text = typeof r.data === "string" ? r.data : JSON.stringify(r.data);
        try { return JSON.parse(text); } catch { return { success: false, total: 0, message: "not json" }; }
    };

    const lookup = async (parcel) => {
        if (delayMs && calls > 0) await sleep(delayMs);

        const prov = String(parcel.province_code ?? "").padStart(2, "0");
        const deed = String(parcel.deed_number ?? "").trim();

        // the app tracks the current deed in a cookie
        jar.set("PROV_CODE", prov);
        jar.set("PARCEL_TYPE", "CHANOD");
        jar.set("S_KEY", deed);

        const payload = {
            PERIODS: PERIOD,
            CHANOD_NO: deed,
            SURVEY_NO: "",
            PROV_CODE: prov,
            DOL_CODE: null,
            AMPH_CODE: null,
            TUMB_CODE: null,
            PROV_DESCR: "          ",
            AMPH_DESCR: "",
            TUMB_DESCR: "",
            LANGUAGE: "TH",
            PARCEL_LAYER: "PARCEL",
            USER_ID: "2",
            FN_ID,
            DEVICE_TYPE: "desktop",
            OS: "Windows",
            COUNTRY: null,
            VISITOR_UUID: jar.get("VISITOR_UUID") ?? "b104bccbd4f1c6c3b2c05dad3a929eb6",
            SP: "GIS5_Q_PARCEL",
            CSRF_TOKEN: csrf ?? "",
            BEGIN: 1,
            // Generous, not 20. The result list is CAPPED by BEGIN/END and
            // several real matches were falling past the cut, which surfaced as
            // "no_location_match" against a full page of rows.
            END: 200,
        };

        const r = await axios.post(
            `${ENDPOINT}?&request.preventCache=${Date.now()}`,
            JSON.stringify(payload),
            base(),
        );
        remember(r);
        calls++;

        const text = typeof r.data === "string" ? r.data : JSON.stringify(r.data);
        let p = null;
        try { p = JSON.parse(text); } catch { /* not json */ }

        if (!p) return { found: false, status: "bad_response", raw: text.slice(0, 300) };
        if (!p.success) return { found: false, status: "error", message: p.message ?? "", raw: text.slice(0, 300) };

        const row = Array.isArray(p.data) ? p.data[0] : null;
        if (!p.data?.length) return { found: false, status: "not_found", message: p.message ?? "" };

        /* The service returns every parcel in the province sharing this deed
           number, not just ours. Hand them all back and let the caller pick by
           location — see pickTdRow(). */
        return {
            found: true,
            status: "ok",
            total: p.total,
            rows: (p.data ?? []).map(normaliseTdRow),
        };
    };

    lookup.calls = () => calls;
    lookup.post = post;

    /**
     * A น.ส.3ก. title number, searched on the layer that holds them.
     *
     * The wire format is NS3A_ID in the body with PARCEL_LAYER=NS3K. The same
     * number sent to the PARCEL layer answers with rows, and every one of them
     * is a different piece of land - a 3-3 number is not a deed number, and the
     * PARCEL layer holds no 3-3 titles. The reply carries the shape, the sheet,
     * the land number and the place, but no area: the area comes from the map
     * layer (tdCadastre.ns3kRows).
     */
    lookup.ns3k = async (ns3aId, provinceCode) => {
        const p = await post({
            SP: "GIS5_Q_PARCEL",
            PARCEL_LAYER: "NS3K",
            NS3A_ID: String(ns3aId),
            PROV_CODE: String(provinceCode ?? "").padStart(2, "0"),
        });
        if (!p?.success || !Array.isArray(p.data)) return [];
        return p.data.map(normaliseTdRow);
    };

    lookup.setProvince = (code) => jar.set("PROV_CODE", String(code).padStart(2, "0"));
    lookup.close = () => {};
    return lookup;
}

/**
 * Choose the layer from the land title LED published.
 *
 * Verified, NOT assumed: searching a น.ส.3ก. number through the โฉนด path
 * returns 20-23 unrelated โฉนด parcels and never the น.ส.3ก. one — 2771 came
 * back with 21 distinct ตำบล, none of them บ้านเรือ. So a น.ส.3ก. number sent
 * to the PARCEL layer looks like a hit while being entirely wrong, which is
 * precisely how the §17 wrong-parcel error would enter via the back door.
 *
 * โฉนด          -> PARCEL, keyed by CHANOD_NO
 * น.ส.3ก.        -> NS3K,  keyed by NS3A_ID (wire format not yet solved)
 * ห้องชุด       -> CONDO, keyed by condo name (untested)
 */
export function layerForTitle(landTitle, assetType = "") {
    const t = String(landTitle ?? "").replace(/\s+/g, "");
    if (/ห้องชุด/.test(String(assetType ?? ""))) return { layer: "CONDO", key: "name", supported: false };
    /* NS3K is solved: NS3A_ID in the body with PARCEL_LAYER=NS3K. A น.ส.3ก.
     * number on the PARCEL layer answers with rows, and every one is a different
     * piece of land. */
    if (/^น\.?ส\.?3ก/.test(t)) return { layer: "NS3K", key: "ns3a", supported: true };
    return { layer: "PARCEL", key: "chanod", supported: true };
}

/** Flatten a returned parcel row into the fields we store. */
export function normaliseTdRow(row) {
    /* Prices arrive comma-grouped ("80,500"), which Number() turns into NaN —
       and a silent NaN writes NULL, losing an 80,500 ฿/ตร.วา appraisal
       without any error. Strip separators, and refuse to invent a 0. */
    const n = (v) => {
        if (v === null || v === undefined || v === "") return null;
        const s = String(v).replace(/[,\s฿]/g, "");
        if (s === "" || s === "-") return null;
        const num = Number(s);
        return Number.isFinite(num) ? num : null;
    };
    // SHAPE is WKT in a projected CRS (EPSG:24048 = Indian 1975 / UTM 48N),
    // NOT lat/lon. Converting it needs a real projection, so hand the raw
    // easting/northing to PostGIS rather than faking it here.
    const m = /POINT\s*\(\s*([-\d.eE+]+)\s+([-\d.eE+]+)\s*\)/i.exec(String(row.SHAPE ?? ""));
    return {
        chanodNo: row.CHANOD_NO ?? null,
        surveyNo: row.SURVEY_NO ?? null,
        rawang: row.RAWANG ?? null,
        tambonName: (row.TUMBON_NAME ?? "").trim() || null,
        amphurName: (row.AMPHUR_NAME ?? "").trim() || null,
        provinceName: row.PROV_NAME ?? null,
        landNo: row.LAND_NO ?? null,
        landOffice: (row.DOL_NAME ?? "").trim() || null,
        branchCode: row.BRANCH_CODE ?? null,
        // บาท/ตร.วา — the per-parcel ราคาประเมิน
        evaPrice: n(row.CURR_EVAPRICE),
        utmEasting: m ? Number(m[1]) : null,
        utmNorthing: m ? Number(m[2]) : null,
        utmSrid: n(row.SRID) ?? 24048,
        raw: row,
    };
}

/* --------------------------------------------------- picking the right row */

/**
 * The service returns EVERY parcel in the province that shares the deed
 * number — 9 to 11 rows in practice, and the list is CAPPED by BEGIN/END.
 * With END=20, matches beyond the 20th row were silently dropped, which is why
 * several ตำบล reported "no_location_match" against a full page of results.
 * END is therefore generous.
 *
 * Verified: deed 32880 exists in หนองเรือ (380 ฿/ตร.ว.) *and* เมืองขอนแก่น
 * (80,500 ฿/ตร.ว.). Taking the first row returns the wrong one at ~1/200th the
 * value. So the row is selected by matching the location LED published — the
 * §17 same-number problem, solved because LED does give us ตำบล and อำเภอ.
 *
 * LED writes the district seat as plain "เมือง" where กรมธนารักย์ writes
 * "เมืองขอนแก่น", so district matching is prefix-tolerant. ตำบล is matched
 * exactly, because that is the discriminating key.
 *
 * Never guesses: zero or multiple survivors come back as ambiguous.
 */
export function pickTdRow(rows, { tumbol, amphur }) {
    if (!rows?.length) return { row: null, status: "not_found" };
    const norm = (s) => String(s ?? "").replace(/\s+/g, "").trim();
    /* LED writes the subdistrict with a locality in brackets - "ในเมือง (ศิลา)"
     * and "หน้าเมือง(ตลาดหน้าเมือง)" - and TD knows the same place under the
     * bracketed name: "ศิลา" and "ตลาดหน้าเมือง" are both in TD's list for those
     * deeds, while the unbracketed form is not. So all three readings count -
     * the whole string, the bracketed part, and the string without the bracket -
     * or those parcels never match. */
    const wantTs = new Set([norm(tumbol)]);
    const paren = /\(([^)]*)\)/.exec(String(tumbol ?? ""));
    if (paren) {
        wantTs.add(norm(paren[1]));
        wantTs.add(norm(String(tumbol).replace(/\s*\([^)]*\)/g, "")));
    }
    const wantA = norm(amphur);
    // "เมือง" must match "เมืองขอนแก่น"; equal or one contained in the other
    const ampOk = (got) => !wantA || !got
        || norm(got) === wantA || norm(got).startsWith(wantA) || wantA.startsWith(norm(got));

    if (!norm(tumbol)) return { row: null, status: "no_tambon_hint", candidates: rows.length };

    let pool = rows.filter((r) => wantTs.has(norm(r.tambonName)));
    if (pool.length === 1) return { row: pool[0], status: "matched" };

    if (pool.length > 1) {
        const narrowed = pool.filter((r) => ampOk(r.amphurName));
        if (narrowed.length === 1) return { row: narrowed[0], status: "matched_tambon_amphur" };
        if (narrowed.length > 1) return { row: null, status: "ambiguous", candidates: narrowed.length };
    }
    if (pool.length > 1) return { row: null, status: "ambiguous", candidates: pool.length };

    return { row: null, status: "no_location_match", candidates: rows.length };
}


/**
 * A lookup that keeps its session alive.
 *
 * The service issues an ASP.NET session and drops it after a while. Once it is
 * gone, every request answers with an empty result - which looks exactly like
 * "this deed is not in the register". Nothing errors, nothing warns. A run that
 * asked 289 parcels in one session therefore decided all 289 were dead ends when
 * most of them were simply never asked, because the session had gone.
 *
 * This wraps the transport: the session is renewed every `renewEvery` calls, and
 * an empty answer is retried once on a fresh session before it is believed. A
 * genuine miss is empty twice; a dead session is empty once.
 */
export async function createResilientLookup({ delayMs = 400, log = () => {}, renewEvery = 25 } = {}) {
    let inner = null;
    let calls = 0;
    let province = null;

    const renew = async () => {
        if (inner) { try { await inner.close(); } catch { /* already gone */ } }
        inner = await createTdLookup({ delayMs, log });
        calls = 0;
        /* The province rides in a cookie, and a new session starts with an empty
         * jar. Without putting it back the query asks every province for the
         * province's own default - which returns rows, and rows from the wrong
         * place, and no error to say so. */
        if (province != null) inner.setProvince(province);
        return inner;
    };

    await renew();

    const lookup = async (parcel) => {
        if (calls >= renewEvery) await renew();
        let res = await inner(parcel);
        calls++;
        if (!res.found && res.status === "not_found") {
            /* Empty. Renew and ask once more before believing it - a dead session
             * and a deed the register does not hold look the same from here. */
            await renew();
            res = await inner(parcel);
            calls++;
        }
        return res;
    };
    lookup.setProvince = (code) => {
        province = code;
        if (inner) inner.setProvince(code);
    };
    lookup.post = (params) => inner.post(params);
    lookup.ns3k = (ns3aId, provinceCode) => inner.ns3k(ns3aId, provinceCode);
    lookup.close = async () => { if (inner) await inner.close(); };
    lookup.renew = renew;
    return lookup;
}
