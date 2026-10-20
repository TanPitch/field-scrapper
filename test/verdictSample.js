/* verdictSample.js — a sample of every outcome, with the evidence.
 *
 *   DATABASE_URL=... bun verdictSample.js [perCategory]
 *
 * For each verdict the pipeline can end on, prints what LED published for the
 * deed, what TD answers for the same deed number, every row it returned, and
 * which one was taken and why. It is meant to be read rather than trusted: the
 * LED side is what we stored from LED, the TD side is queried live.
 */
import { createTdLookup } from "./tdLookup.js";
import { dictionaries } from "./tdDict.js";
import { Client } from "pg";

const per = Number(process.argv[2] || 3);
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const dict = dictionaries();
const line = (s) => console.log(s);

const CATEGORIES = [
  { name: "PLACED - TD matched the district and the subdistrict", where: `p.td_lat IS NOT NULL AND p.td_verdict = 'match' AND p.dol_verdict IS NULL` },
  { name: "PLACED - matched, but the DOL leg also ran and disagreed", where: `p.td_lat IS NOT NULL AND p.td_verdict = 'match' AND p.dol_verdict IS NOT NULL` },
  { name: "UNPLACED - TD has the deed, but in another district", where: `p.td_lat IS NULL AND p.dol_verdict = 'district_mismatch'` },
  { name: "UNPLACED - TD has nothing under this deed number", where: `p.td_lat IS NULL AND p.dol_verdict = 'no_result'` },
  { name: "UNPLACED - TD has more than one parcel for it", where: `p.td_lat IS NULL AND p.dol_verdict = 'ambiguous'` },
  { name: "MATCHED but never placed - no coordinates came back", where: `p.td_lat IS NULL AND p.td_verdict = 'match'` },
];

const lookup = await createTdLookup({ delayMs: 400, log: () => {} });

for (const cat of CATEGORIES) {
  const { rows } = await db.query(
    `SELECT p.id, p.deed_number, l.case_no, l.case_year, p.province_name, p.district_name,
            p.tumbol, p.district_dol_code, p.province_code, d.td_code, d.td_province_code,
            d.code AS led_code, d.name AS districts_ref,
            p.td_lat, p.td_lon, p.td_verdict, p.dol_verdict, p.geo_note, p.td_status,
            p.land_title_raw
       FROM parcels p
       JOIN districts d ON d.id = (SELECT id FROM districts dd
                                    WHERE dd.province_id = p.province_code
                                      AND dd.dol_code = p.district_dol_code LIMIT 1)
       LEFT JOIN auction_lots l ON l.parcel_id = p.id
      WHERE ${cat.where}
      ORDER BY p.id LIMIT $1`, [per]);
  if (!rows.length) { line(`\n=== ${cat.name} ===\n   (none)`); continue; }
  line(`\n================ ${cat.name} ================`);
  for (const p of rows) {
    const dd = dict.ledDistricts[String(p.led_code)] ?? null;
    line(`\n  parcel ${p.id}   deed ${p.deed_number}   case ${p.case_no}/${p.case_year}`);
    line(`    LED said     ${p.province_name} / ${p.district_name} / ${p.tumbol}   (${p.land_title_raw})`);
    line(`    we stored   province ${p.province_code} district_dol_code ${p.district_dol_code}  (districts name "${p.districts_ref}")`);
    line(`    TD mapping  province ${p.td_province_code} district ${p.td_code}  ->  "${dd?.tdDistrictName ?? "?"}"`);
    line(`    our verdict td_verdict=${p.td_verdict}  dol_verdict=${p.dol_verdict}  status=${p.td_status}`);
    line(`    our coord   ${p.td_lat != null ? `${Number(p.td_lat).toFixed(6)}, ${Number(p.td_lon).toFixed(6)}` : "(none)"}`);
    if (p.geo_note) line(`    note        ${p.geo_note}`);

    if (!p.td_province_code) { line(`    TD          not queried - no TD mapping`); continue; }
    lookup.setProvince(p.td_province_code);
    const td = await lookup({ deed_number: p.deed_number, province_code: p.td_province_code });
    const tdRows = td.rows ?? [];
    line(`    TD answer   ${tdRows.length} row(s) for CHANOD_NO=${p.deed_number} PROV_CODE=${p.td_province_code}` +
      (td.found ? "" : `   (TD says: ${td.status})`));
    for (const r of tdRows) {
      const tOk = (r.tambonName ?? "").trim() === (p.tumbol ?? "").trim();
      const aOk = (r.amphurName ?? "").trim() === (dd?.tdDistrictName ?? "").trim();
      line(`       ${tOk ? "TAMBON-MATCH " : "            "} ${aOk ? "DISTRICT-MATCH" : "             "}  amphur "${r.amphurName}"  tambon "${r.tambonName}"  land_no ${r.landNo}  survey ${r.surveyNo}  rawang ${r.rawang}`);
    }
    if (tdRows.length) {
      const byT = tdRows.filter((r) => (r.tambonName ?? "").trim() === (p.tumbol ?? "").trim());
      const byA = tdRows.filter((r) => (r.amphurName ?? "").trim() === (dd?.tdDistrictName ?? "").trim());
      line(`    -> ${byT.length} row(s) with our subdistrict, ${byA.length} with our district`);
    }
  }
}

await lookup.close();
await db.end();