/* probeArea.js — ask TD every way, with a session, and look for the area.
 *
 *   bun probeArea.js <deedNumber> [provinceCode] [amphurCode]
 *
 * The answer, for the record: the parcel row has 27 fields and not one of them
 * is an area. CURR_EVAPRICE is a rate - baht per square wah - and what the map
 * on TD's site shows must come from somewhere this API does not serve.
 *
 * The parcel search answers with a rate - CURR_EVAPRICE is baht per square wah -
 * and no area at all. The map on TD's site does show the size. This asks for the
 * same parcel every way the API allows, with the session, and prints every field
 * each answer carries.
 */
import { createTdLookup } from "./tdLookup.js";

const deed = String(process.argv[2] ?? "34062");
const prov = String(process.argv[3] ?? "83");
const amph = String(process.argv[4] ?? "1");
const line = (s) => console.log(s);

const lookup = await createTdLookup({ delayMs: 300, log: () => {} });
lookup.setProvince(prov);

const show = (label, j) => {
  line(`\n  --- ${label}: success=${j.success} total=${j.total} message=${j.message ?? ""}`);
  for (const d of (j.data ?? []).slice(0, 2)) {
    for (const [k, v] of Object.entries(d)) {
      const s = String(v);
      if (s.length > 200) continue;
      line(`      ${k} = ${s}`);
    }
  }
};

const base = { PROV_CODE: prov, PARCEL_LAYER: "PARCEL" };

show("PARCEL / CHANOD_NO", await lookup.post({
  ...base, SP: "GIS5_Q_PARCEL", PARCEL_TYPE: "CHANOD_NO", CHANOD_NO: deed, SURVEY_NO: "",
}));
show("PARCEL / LAND_NO", await lookup.post({
  ...base, SP: "GIS5_Q_PARCEL", PARCEL_TYPE: "LAND_NO", LAND_NO: deed, CHANOD_NO: "", SURVEY_NO: "",
}));
show("PARCEL / SURVEY_NO", await lookup.post({
  ...base, SP: "GIS5_Q_PARCEL", PARCEL_TYPE: "SURVEY_NO", SURVEY_NO: deed, CHANOD_NO: "", LAND_NO: "",
}));
show("CONDO", await lookup.post({
  SP: "GIS5_Q_CONDO", PARCEL_LAYER: "CONDO", CHANOD_NO: deed, AMPH_CODE: amph, PROV_CODE: prov,
  CONDO_NAME: null, TUMB_CODE: null,
}));
show("CONSTRUCTION", await lookup.post({
  ...base, SP: "GIS5_Q_CONSTRUCTION", CHANOD_NO: deed, AMPH_CODE: amph,
}));
show("LUT_Q_BND districts", await lookup.post({
  SP: "LUT_Q_BND", SYS_ID: "GIS5", PROV_CODE: prov,
}));

await lookup.close();