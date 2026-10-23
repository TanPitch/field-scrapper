/* sampleOffsets.js — the hand-read กรมที่ดิน points, checked and then measured.
 *
 *   bun sampleOffsets.js <sampleFile> <answersFile>
 *
 * The sample file is what sampleCoords.js printed: for every land it names the
 * case, the place, LED's size, and the two points TD gives - raw, with no
 * correction at all, and corrected, with the calibration for that SRID applied.
 * The answers file is what a person read back off กรมที่ดิน's site: deed,
 * size, point, amphur, tambon.
 *
 * A point is only used if its size and its place agree with LED's own row.
 * The rest is arithmetic. กรมที่ดิน's point minus the raw TD point is the
 * datum for that province; minus the corrected point is what our marker still
 * gets wrong. Grouped by SRID the first should come out one number for the
 * whole country - that is what makes a single calibration per SRID lawful -
 * and the medians of it are the calibration the country actually wants.
 *
 * Nothing is written. A land whose point lands more than --tol= (default 25 m)
 * from its own corrected point is held out of the fit: with the size and place
 * both right and its neighbours agreeing, that is a mis-read point, not a
 * datum, and one bad number must not shift a whole zone.
 */
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { loadCalibration } from "./tdCrs.js";

const [sampleFile, answersFile] = process.argv.slice(2);
if (!sampleFile || !answersFile) {
    console.log("  usage: bun sampleOffsets.js <sampleFile> <answersFile>");
    process.exit(1);
}

const METRE_PER_DEG = 111320;
const TOL = Number((process.argv.find((a) => a.startsWith("--tol=")) ?? "").slice(6)) || 25;

/* --- the sample file --- */
const samples = new Map();   // deed -> { province, amphur, tambon, size, srid, raw, corrected, cal, ledSqWa }
let prov = null;
for (const line of readFileSync(sampleFile, "utf8").split("\n")) {
    const head = line.match(/===\s+(.+?)\s+\(LED\s+(\d+),\s*TD\s+(\d+)\)/);
    if (head) { prov = head[1]; continue; }
    const row = line.match(/โฉนด\s+(\d+)\s+(\S+)\s+order\s+(\S+)\s+(\S+)\/(\S+)\s+size\s+(\S+)\s+srid\s+(\d+)\s+ระวาง\s+(\S+)\s+land_no\s+(\d+)/);
    if (row) {
        samples.set(row[1], {
            province: prov, case: row[2], order: row[3],
            amphur: row[4], tambon: row[5], size: row[6], srid: Number(row[7]),
            raw: null, corrected: null, cal: null, ledSqWa: null, cadastre: null,
        });
        continue;
    }
    const pts = line.match(/raw\s+(-?[\d.]+),\s*(-?[\d.]+)\s+corrected\s+(-?[\d.]+),\s*(-?[\d.]+)(?:\s+\(cal\s+(-?[\d.]+)m\s+(-?[\d.]+)m\))?/);
    const last = [...samples.values()].pop();
    if (!last) continue;
    if (pts && last.raw == null) {
        last.raw = [Number(pts[1]), Number(pts[2])];
        last.corrected = [Number(pts[3]), Number(pts[4])];
        last.cal = pts[5] ? [Number(pts[5]), Number(pts[6])] : null;
        continue;
    }
    const area = line.match(/LED\s+([\d.]+)\s+ตร\.ว\.\s+cadastre\s+(\S+)\s+\(([\d.]+)\)\s+(AGREE|\*\* do not agree \*\*)/);
    if (area && last.ledSqWa == null) {
        last.ledSqWa = Number(area[1]);
        last.cadastre = { area: area[2], sqWa: Number(area[3]), agree: area[4] === "AGREE" };
    }
}

/* --- the answers --- */
const answers = new Map();
for (const line of readFileSync(answersFile, "utf8").split("\n")) {
    const m = line.match(/^\s*(\d+)\s*:\s*([\d.]+(?:-[\d.]+)*)\s+\[(-?[\d.]+),\s*(-?[\d.]+)\]\s+(\S.*\S)\s*$/);
    if (m) answers.set(m[1], { size: m[2], lat: Number(m[3]), lon: Number(m[4]), place: m[5] });
}

const sqWa = (s) => String(s).split("-").reduce((a, v, i) => a + Number(v || 0) * [400, 100, 1][i], 0);

const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

const metres = (dLat, dLon, lat) => [dLat * METRE_PER_DEG, dLon * METRE_PER_DEG * Math.cos((lat * Math.PI) / 180)];

console.log("  deed    province      size         place                     size?  place?  DOL-corrected");
const verified = [], rejected = [];
for (const [deed, a] of answers) {
    const s = samples.get(deed);
    if (!s) { rejected.push([deed, "not in the sample"]); continue; }
    const sizeOk = Math.abs(sqWa(a.size) - s.ledSqWa) <= Math.max(1, s.ledSqWa * 0.005);
    const placeOk = a.place === `${s.amphur} ${s.tambon}`;
    const [clat, clon] = metres(a.lat - s.corrected[0], a.lon - s.corrected[1], a.lat);
    const tag = `${String(Math.round(clat)).padStart(4)}m ${String(Math.round(clon)).padStart(4)}m`;
    console.log(`   ${deed.padEnd(7)} ${s.province.padEnd(14)} ${a.size.padEnd(12)} ${(s.amphur + "/" + s.tambon).padEnd(24)} ` +
        `${sizeOk ? "ok " : "NO "}    ${placeOk ? "ok " : "NO "}    ${tag}`);
    (sizeOk && placeOk ? verified : rejected).push([deed, sizeOk && placeOk ? null : `size ${sizeOk ? "ok" : "WRONG"} / place ${placeOk ? "ok" : "WRONG"}`]);
}
for (const [deed, why] of rejected) console.log(`   ✗ ${deed}: excluded - ${why}`);

/* --- offsets --- */
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

const provAgg = new Map();
const held = [];
for (const deed of verified.map((v) => v[0])) {
    const s = samples.get(deed), a = answers.get(deed);
    const vsRaw = metres(a.lat - s.raw[0], a.lon - s.raw[1], a.lat);
    const vsCorr = metres(a.lat - s.corrected[0], a.lon - s.corrected[1], a.lat);
    const mag = Math.hypot(...vsCorr);
    if (mag > TOL) {
        held.push(`${deed} ${s.province} ${s.amphur}/${s.tambon}: ${mag.toFixed(1)} m from its own corrected point`);
        continue;
    }
    const key = `${s.province}|${s.srid}`;
    if (!provAgg.has(key)) provAgg.set(key, { province: s.province, srid: s.srid, n: 0, raw: [[], []], corr: [[], []], worst: { deed, mag } });
    const g = provAgg.get(key);
    g.n++; g.raw[0].push(vsRaw[0]); g.raw[1].push(vsRaw[1]); g.corr[0].push(vsCorr[0]); g.corr[1].push(vsCorr[1]);
    if (mag > g.worst.mag) g.worst = { deed, mag };
}

console.log("\n  province      srid    n   กรมที่ดิน − raw TD (lat, lon)    กรมที่ดิน − corrected (lat, lon)   worst");
const bySrid = new Map();
for (const g of [...provAgg.values()].sort((a, b) => a.srid - b.srid || a.province.localeCompare(b.province))) {
    const mean = (xs) => xs.reduce((a, v) => a + v, 0) / xs.length;
    const r = [mean(g.raw[0]), mean(g.raw[1])], c = [mean(g.corr[0]), mean(g.corr[1])];
    console.log(`   ${g.province.padEnd(14)} ${g.srid}  ${String(g.n).padStart(2)}   ` +
        `${r[0].toFixed(1).padStart(7)}, ${r[1].toFixed(1).padStart(7)}      ` +
        `${c[0].toFixed(1).padStart(7)}, ${c[1].toFixed(1).padStart(7)}      ${g.worst.deed} ${g.worst.mag.toFixed(1)}m`);
    if (!bySrid.has(g.srid)) bySrid.set(g.srid, { lands: 0, provinces: 0, rawAll: [[], []], corrMags: [] });
    const b = bySrid.get(g.srid);
    b.lands += g.n; b.provinces++;
    b.rawAll[0].push(...g.raw[0]); b.rawAll[1].push(...g.raw[1]);
}

console.log(`\n  --- the datum, per SRID, over the whole country ---`);
if (held.length) console.log(`  held out of the fit: ${held.join("; ")}`);
for (const [srid, b] of bySrid) {
    const ml = median(b.rawAll[0]), mo = median(b.rawAll[1]);
    const cal = await loadCalibration(db, { srid });
    const applied = cal ? [Number(cal.d_lat_m), Number(cal.d_lon_m)] : null;
    /* Marker error is measured against the calibration in force, not against
     * whatever the file recorded at sample time: after a refit the file is the
     * stale one and this is the number that has to shrink. */
    b.corrMags = [];
    for (const g of provAgg.values()) {
        if (g.srid !== srid) continue;
        for (let i = 0; i < g.raw[0].length; i++) b.corrMags.push(Math.hypot(g.raw[0][i] - ml, g.raw[1][i] - mo));
    }
    const devs = [];
    for (const g of provAgg.values()) {
        if (g.srid !== srid) continue;
        const mean = (xs) => xs.reduce((a, v) => a + v, 0) / xs.length;
        devs.push(Math.hypot(mean(g.raw[0]) - ml, mean(g.raw[1]) - mo));
    }
    console.log(`   srid ${srid}: ${b.lands} lands, ${b.provinces} provinces`);
    console.log(`     measured กรมที่ดิน − raw:  d_lat ${ml.toFixed(1)} m, d_lon ${mo.toFixed(1)} m   (province spread ±${Math.max(...devs).toFixed(1)} m)`);
    console.log(`     applied today:            ${applied ? `d_lat ${applied[0].toFixed(1)} m, d_lon ${applied[1].toFixed(1)} m` : "no row"}`);
    const cm = b.corrMags.sort((x, y) => x - y);
    console.log(`     marker error now:         median ${median(b.corrMags).toFixed(1)} m, worst ${cm[cm.length - 1].toFixed(1)} m`);
    const resids = [];
    for (const g of provAgg.values()) {
        if (g.srid !== srid) continue;
        const mean = (xs) => xs.reduce((a, v) => a + v, 0) / xs.length;
        resids.push([g.province, Math.hypot(mean(g.raw[0]) - ml, mean(g.raw[1]) - mo)]);
    }
    console.log(`     residual after the median: ${resids.map(([p, r]) => `${p} ${r.toFixed(1)}m`).join(", ")}`);
}

await db.end();
