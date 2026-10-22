/* tdCadastre.js — the official land area, from the cadastre layer.
 *
 *   bun tdCadastre.js <chanod> [provinceCode] [amphurName] [tumbonName]
 *
 * TD's search endpoint answers with a rate - CURR_EVAPRICE is baht per square
 * wah - and no area at all. The MAP on TD's site is an ArcGIS feature service,
 * and that layer carries the area:
 *
 *   LAND_AREA     the area, as ไร่-งาน-ตร.วา ("0-0-36.00")
 *   UTMMAP1..4    the sheet, which is the key our own eva_land_sheet table uses
 *   UTMSCALE      the sheet's scale
 *   LAND_NO       the land number
 *   AMPHUR_CODE   the district, to filter on
 *   TUMBON_CODE   the subdistrict, to filter on
 *   CHANOD_NO     the deed number - NUMERIC, and it repeats across districts
 *
 * Two things make the query awkward. A deed number is not unique: 34062 is held by
 * 251 parcels nationwide, so it must be narrowed by district and subdistrict. And
 * the field types differ - CHANOD_NO is numeric and must not be quoted, while
 * AMPHUR_CODE, TUMBON_CODE and CHANGWAT_CODE are strings and must be, or the
 * server answers "Unable to complete operation".
 *
 * A ห้องชุด is a special case and never matches: LED publishes the unit's floor
 * area and this layer publishes the land under the building. Deed 44021 is 30.35
 * square metres in LED and 3-0-15.50, some 1,215 square wah, here.
 */
import { dictionaries } from "./tdDict.js";

const PROXY = "https://assessprice.treasury.go.th/assessprice/ashx/Proxy.ashx?";
const SVC = "https://p-gis.treasury.go.th/arcgis/rest/services/TD_ASSET/TD_Former_View/MapServer";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36";

/** "2-2-11.00" -> 1011 square wa. null when the field is missing or "-". */
export function areaToSqWa(s) {
  const m = /^(\d+)-(\d+)-([\d.]+)$/.exec(String(s ?? "").trim());
  if (!m) return null;
  return Number(m[1]) * 400 + Number(m[2]) * 100 + Number(m[3]);
}

const get = async (url) => {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { __raw: t.slice(0, 300) }; }
};

/**
 * One query against one layer of the map service.
 *
 * The service will not list its layers without a token, but it will serve any
 * layer's rows, so the layer numbers are the ones the layers are known by:
 *
 *   0, 1   โฉนด        PARCEL - CHANOD_NO, the deed number
 *   2, 3   น.ส.3ก.      NS3K   - NS3A_ID, the 3-3 title number
 *   4      สำนักงานที่ดิน
 *
 * The NS3K layers are the reason this is generic. A น.ส.3ก. number sent to a
 * PARCEL layer looks like a hit and is entirely wrong, and the PARCEL layers
 * hold no 3-3 titles at all.
 */
export async function queryLayer(layer, where) {
  const q = await get(
    `${PROXY}${SVC}/${layer}/query?where=${encodeURIComponent(where)}&outFields=*&returnGeometry=true&f=json`);
  return (q.features ?? []).map((f) => ({ ...f.attributes, __layer: layer }));
}

/** Rows the cadastre holds for a deed number, whatever the district. */
export async function cadastreRows(chanod) {
  const out = [];
  for (const layer of [0, 1]) {
    const rows = await queryLayer(layer, `CHANOD_NO=${chanod}`);
    for (const r of rows) out.push(r);
  }
  return out;
}

/**
 * The น.ส.3ก. parcels of one province carrying one 3-3 title number.
 *
 * The number is not unique - a 3-3 number is held by several parcels in a
 * province - so the province is part of the question and the area is the
 * answer.
 */
export async function ns3kRows(ns3aId, provinceCode) {
  const where = provinceCode
    ? `NS3A_ID=${ns3aId} AND CHANGWAT_CODE='${provinceCode}'`
    : `NS3A_ID=${ns3aId}`;
  return queryLayer(2, where);
}

/**
 * The official area for a parcel, matched on the place TD itself named.
 *
 * The names come from TD's own search row, so no extra codes are needed: the
 * cadastre holds the same AMPHUR_NAME and TUMBON_NAME, and a parcel in a
 * district of the same name is a different parcel.
 */
export async function officialArea({ chanod, provinceCode, amphurName, tumbonName }) {
  const rows = await cadastreRows(chanod);
  const same = (a, b) => String(a ?? "").trim() === String(b ?? "").trim();
  const hits = rows.filter((r) =>
    (!provinceCode || same(r.CHANGWAT_CODE, provinceCode)) &&
    (!amphurName || same(r.AMPHUR_NAME, amphurName)) &&
    (!tumbonName || same(r.TUMBON_NAME, tumbonName)));
  if (!hits.length) {
    return { found: false, candidates: rows.length };
  }
  if (hits.length > 1) {
    return { found: false, ambiguous: hits.length, candidates: rows.length, hits };
  }
  const r = hits[0];
  return {
    found: true,
    candidates: rows.length,
    area: r.LAND_AREA ?? null,
    sqWa: areaToSqWa(r.LAND_AREA),
    sheet: [r.UTMMAP1, r.UTMMAP2, r.UTMMAP3, r.UTMMAP4].join("-"),
    scale: r.UTMSCALE,
    landNo: r.LAND_NO,
    province: r.CHANGWAT_NAME ?? r.CHANGWAT_CODE,
    amphur: r.AMPHUR_NAME,
    tumbon: r.TUMBON_NAME,
    codes: `${r.CHANGWAT_CODE}-${r.AMPHUR_CODE}-${r.TUMBON_CODE}`,
    rate: r.CURR_EVAPRICE,
    row: r,
  };
}

/* ---------------------------------------------------------------- CLI ----- */
if (import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1]).href) {
  const [chanod, provCode, amphur, tumbon] = process.argv.slice(2);
  const rows = await cadastreRows(chanod);
  console.log(`  ${rows.length} parcel(s) in the cadastre carry deed ${chanod}`);
  const dict = dictionaries();
  const hit = await officialArea({
    chanod,
    provinceCode: provCode ?? null,
    amphurName: amphur ?? null,
    tumbonName: tumbon ?? null,
  });
  if (!hit.found) {
    console.log(`  no single match: ${JSON.stringify({ candidates: hit.candidates, ambiguous: hit.ambiguous ?? 0 })}`);
    if (hit.hits) for (const h of hit.hits) console.log(`     ${h.AMPHUR_NAME}/${h.TUMBON_NAME}  area=${h.LAND_AREA}  sheet=${h.UTMMAP1}-${h.UTMMAP2}-${h.UTMMAP3}-${h.UTMMAP4}@${h.UTMSCALE} land_no=${h.LAND_NO}`);
  } else {
    console.log(`\n  MATCH`);
    console.log(`     sheet      ${hit.sheet} @${hit.scale}   land_no ${hit.landNo}`);
    console.log(`     place      ${hit.province} / ${hit.amphur} / ${hit.tumbon}  (${hit.codes})`);
    console.log(`     LAND_AREA  ${hit.area}  ->  ${hit.sqWa} ตร.ว.`);
    console.log(`     rate       ${hit.rate} บาท/ตร.ว.`);
  }
  void dict;
}