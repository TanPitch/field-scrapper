/**
 * assessprice_client.js — Unofficial Node.js client for the assessment service
 * behind https://assessprice.treasury.go.th/ (กรมธนารักษ์ / Treasury Dept).
 *
 * Reverse-engineered from the site's own network traffic; verified live.
 * No login / CSRF token required (public guest mode USER_ID=2).
 *
 * THE ONE ENDPOINT THE SITE USES
 * ------------------------------
 * POST https://assessprice.treasury.go.th/assessprice/ashx/Proxy.ashx?https://assessprice.treasury.go.th/assessprice/services/DataService.svc/DS_TRANSIT?
 * Content-Type: application/x-www-form-urlencoded
 * Body: SP=<procedure>&<filters...>
 *
 * Node 18+ (built-in fetch) — no dependencies.
 */

const BASE = "https://assessprice.treasury.go.th/assessprice";
const DS_TRANSIT =
  `${BASE}/ashx/Proxy.ashx?${BASE}/services/DataService.svc/DS_TRANSIT?`;

const HEADERS = {
  "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  Accept: "application/json",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  Origin: "https://assessprice.treasury.go.th",
  Referer: "https://assessprice.treasury.go.th/",
};

// drop null/undefined/'' — the site's own request class does the same
const clean = (o) =>
  Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== "")
  );

class AssessPriceClient {
  constructor(visitorUuid) {
    // any random hex string works (verified)
    this.visitorUuid =
      visitorUuid ||
      Array.from({ length: 32 }, () =>
        Math.floor(Math.random() * 16).toString(16)
      ).join("");
  }

  async _sp(sp, params = {}) {
    const body = new URLSearchParams(clean({ ...params, SP: sp }));
    const res = await fetch(DS_TRANSIT, {
      method: "POST",
      headers: HEADERS,
      body: body.toString(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  // ------------------------------------------------ dropdown data (จังหวัด/อำเภอ/ตำบล)
  async getProvinces() {
    // 77 provinces -> [{CODE:"10", DESCR:"กรุงเทพมหานคร"}, ...]
    const r = await this._sp("LUT_Q_BND", { SYS_ID: "GIS5" });
    return r.data || [];
  }

  async getDistricts(provCode, layer = null) {
    // อำเภอ/เขต (layer="PARCEL" mirrors the deed form, adds pseudo-entry for BKK)
    const r = await this._sp("LUT_Q_BND", {
      PROV_CODE: provCode,
      SYS_ID: "GIS5",
      LAYER: layer,
    });
    return r.data || [];
  }

  async getSubdistricts(provCode, amphCode) {
    const r = await this._sp("LUT_Q_BND", {
      PROV_CODE: provCode,
      AMPH_CODE: amphCode,
      SYS_ID: "GIS5",
    });
    return r.data || [];
  }

  async getLandOffices(provCode) {
    // สำนักงานที่ดิน -> [{CODE:"10000000", DESCR:"สำนักงานที่ดินกรุงเทพมหานคร"}, ...]
    const r = await this._sp("LUT_Q_DOL", { PROV_CODE: provCode });
    return r.data || [];
  }

  async getPeriods() {
    // -> [{PERIODS_ID: 7, PERIODS_NAME: "2566 - 2569"}]
    const r = await this._sp("LUT_Q_PERIODS");
    return r.data || [];
  }

  // ------------------------------------------------------- parcel search
  async _parcel(filters) {
    const base = {
      PERIODS: "7",               // 2566-2569
      PARCEL_LAYER: "PARCEL",     // "PARCEL" ที่ดิน/น.ส.4จ, "NS3K" น.ส.3ก
      LANGUAGE: "TH",
      USER_ID: "2",               // guest
      BEGIN: 1,                   // pagination rows BEGIN..END
      END: 20,
      VISITOR_UUID: this.visitorUuid,
      FLAG_DVALUE: 1,
      ...filters,
    };
    return this._sp("GIS5_Q_PARCEL", base);
  }

  /** Search land parcel by title-deed number (เลขที่โฉนด). */
  async searchByChanod(chanodNo, provCode, opts = {}) {
    return this._parcel({
      CHANOD_NO: chanodNo,
      SURVEY_NO: opts.surveyNo || null,   // หน้าสำรวจ (disambiguates duplicates)
      PARCEL_TYPE: "CHANOD_NO",
      PROV_CODE: provCode,
      PROV_DESCR: opts.provDescr || null,
      DOL_CODE: opts.dolCode || null,
      ORG_CODE: opts.dolCode || null,
      AMPH_CODE: opts.amphCode || null,
      TUMB_CODE: opts.tumbCode || null,
      BEGIN: ((opts.page || 1) - 1) * (opts.pageSize || 20) + 1,
      END: (opts.page || 1) * (opts.pageSize || 20),
    });
  }

  /** Search land parcel by land number (เลขที่ดิน) + UTM sheet parts. */
  async searchByLandNo(landNo, provCode, utmMap1, opts = {}) {
    // utmMap1 = แผนที่ภูมิประเทศ e.g. "5136III"; utmMap3 = ระวาง "6414"; utmMap4 = แผ่นที่ "04"
    return this._parcel({
      LAND_NO: landNo,
      UTM: utmMap1,
      UTM_MAP1: utmMap1,
      UTM_MAP3: opts.utmMap3 || null,
      UTM_MAP4: opts.utmMap4 || null,
      PARCEL_TYPE: "LAND_NO",
      PROV_CODE: provCode,
      PROV_DESCR: opts.provDescr || null,
      DOL_CODE: opts.dolCode || null,
      ORG_CODE: opts.dolCode || null,
      BEGIN: ((opts.page || 1) - 1) * (opts.pageSize || 20) + 1,
      END: (opts.page || 1) * (opts.pageSize || 20),
    });
  }
}

module.exports = { AssessPriceClient, DS_TRANSIT };

// ------------------------------------------------------------------ demo
if (require.main === module) {
  (async () => {
    const c = new AssessPriceClient();

    const provs = await c.getProvinces();
    console.log("provinces:", provs.length, provs.slice(0, 3));

    const d = await c.getDistricts("10");
    console.log("BKK districts:", d.length, d.slice(0, 3));

    const r = await c.searchByChanod("29139", "10", {
      surveyNo: "18637",
      provDescr: "กรุงเทพมหานคร",
    });
    console.log("chanod search:", r.success, r.total, r.data?.[0]);

    const r2 = await c.searchByLandNo("1693", "10", "5136III", {
      utmMap3: "6414",
      utmMap4: "04",
      provDescr: "กรุงเทพมหานคร",
    });
    console.log("land search:", r2.success, r2.total, r2.data?.[0]);
  })().catch(console.error);
}
