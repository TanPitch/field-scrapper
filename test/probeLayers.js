/* probeArea7.js — the ArcGIS layer, through the proxy, in full.
 *
 *   bun probeArea7.js [chanod]
 *
 * The web map on TD's site is this service, and the popup it draws comes from
 * the layer's fields. If the site shows a size, the size is a field here. The
 * layer is a point layer, so the land's outline is not in it - but a field
 * carrying the area still could be.
 */
const PROXY = "https://assessprice.treasury.go.th/assessprice/ashx/Proxy.ashx?";
const SVC = "https://p-gis.treasury.go.th/arcgis/rest/services/TD_ASSET/TD_Former_View/MapServer";
const chanod = process.argv[2] ?? "34062";
const line = (s) => console.log(s);

const get = async (url) => {
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 Chrome/120.0" } });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { __raw: t.slice(0, 400) }; }
};

const svc = await get(`${PROXY}${SVC}?f=json`);
line("================ service ================");
line(`  layers: ${(svc.layers ?? []).map((l) => `${l.id}:${l.name}[${l.geometryType}]`).join("\n          ")}`);

for (const layer of (svc.layers ?? [])) {
  const info = await get(`${PROXY}${SVC}/${layer.id}?f=json`);
  const fields = (info.fields ?? []).map((f) => `${f.name}(${f.alias ?? ""})`);
  line(`\n================ layer ${layer.id} ${layer.name} ================`);
  line(`  ${fields.length} fields:`);
  for (const f of fields) line(`     ${f}`);
}

/* and a real parcel, every field, geometry included */
for (const layer of (svc.layers ?? [])) {
  const where = layer.id === 0 ? `CHANOD_NO='${chanod}'` : "1=1";
  const q = await get(`${PROXY}${SVC}/${layer.id}/query?where=${encodeURIComponent(where)}&outFields=*&returnGeometry=true&f=json`);
  if (!q.features?.length) continue;
  line(`\n================ layer ${layer.id} ${layer.name}: a row for ${where} ================`);
  for (const f of q.features.slice(0, 1)) {
    for (const [k, v] of Object.entries(f.attributes ?? {})) line(`   ${k} = ${String(v).slice(0, 180)}`);
    if (f.geometry) line(`   geometry = ${JSON.stringify(f.geometry).slice(0, 220)}`);
  }
}