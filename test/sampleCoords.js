/* sampleCoords.js — a few lands per province, and what TD says about them.
 *
 *   bun sampleCoords.js <province> [<province> ...] [--per=3]
 *
 * Reads LED's own listing for each province, picks the first few rows that name
 * a deed, a case and a size, and asks TD about each. It prints two points:
 *
 *   raw        what PostGIS makes of TD's UTM pair with no correction at all
 *   corrected  what the app stores, with the calibration for that SRID applied
 *
 * The difference between the two is the datum shift, and it is only known
 * because กรมที่ดิน's own coordinates were measured against it. This is how a
 * whole new province gets its own number: take the same land on
 * กรมที่ดิน's site, read its point, and compare.
 *
 * A sample is only worth having if it is the right land, so the row TD returns
 * has to be the one in the place LED named, and the official area has to agree
 * with LED's size. A deed number is not unique, and taking the first row is how
 * a land ends up marked in the wrong district.
 *
 * Nothing is written. The provinces it reads are mostly ones we have never
 * scraped, and a sample is not a scrape. Piping this script's output to a file
 * through PowerShell's `| Out-File` mangles Thai (the console decodes bun's
 * UTF-8 as the OEM codepage), so capture with cmd redirection instead:
 *   cmd /c "bun sampleCoords.js ... > research/samples/<name>.txt"
 */
import { Client } from "pg";
import { LedClient } from "./ledClient.js";
import { createTdLookup } from "./tdLookup.js";
import { officialArea } from "./tdCadastre.js";
import { dictionaries } from "./tdDict.js";
import { loadCalibration, calibratedTransform } from "./tdCrs.js";

const PER = Number((process.argv.find((a) => a.startsWith("--per=")) ?? "").slice(6)) || 3;
const names = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const dict = dictionaries();
const provByName = new Map(Object.entries(dict.ledProvinces).map(([k, v]) => [v.name, { code: k, ...v }]));

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

const led = new LedClient({ baseDelayMs: 900, verbose: false });
await led.open();
const td = await createTdLookup({ delayMs: 700, log: () => {} });

const raw = (srid) => `ST_Transform(ST_SetSRID(ST_MakePoint($1::double precision, $2::double precision), ${srid}), 4326)`;

for (const name of names) {
    const p = provByName.get(name);
    if (!p) { console.log(`\n  ${name}: not in the LED province dictionary`); continue; }
    const tdProv = p.tdCode;

    console.log(`\n  === ${name} (LED ${p.code}, TD ${tdProv}) ===`);
    let shown = 0, tried = 0, page = 1;

    /* Pages are walked until there is enough. A province's first page can be a
     * single condominium - ชลบุรี's is one building sold as thirty units -
     * and a sample of condos is no use for measuring a datum. */
    while (shown < PER && page <= 8) {
        const fields = {
            province: name, ampur: "", tumbol: "", asset_type: "", person1: "", bid_date: "",
            price_begin: "", price_end: "", rai_if: "1", rai: "", quaterrai_if: "1", quaterrai: "",
            wa_if: "1", wa: "", search: "ok", page: String(page),
        };
        fields.oseckey = led.seckey;
        fields.seckey = led.seckey;

        const res = await led.search(fields, { expectRows: false });
        if (!res?.rowCount) break;
        const $ = res.$;

        /* Rows that name a deed, a case and a size, and are plain land. A
         * ห้องชุด is excluded: its figure is the room's floor area and the two
         * agencies publish different things for it. */
        const cands = [];
        $("tr").filter((i, e) => $(e).find('input[name="deedno"]').length > 0).each((i, e) => {
            const key = {};
            $(e).find("input[name]").each((j, el) => { key[$(el).attr("name")] = $(el).attr("value") ?? ""; });
            const deed = String(key.deedno ?? "").trim();
            const caseNo = String(key.law_suit_no ?? "").trim();
            const title = String(key.landtype ?? "").trim();
            const rai = Number(key.rai), ng = Number(key.quaterrai), wa = Number(key.wa);
            if (!deed || !caseNo) return;
            if (/3\s*ก/.test(title) || /ห้องชุด/.test(String(key.assettypedesc ?? ""))) return;
            if (!Number.isFinite(rai) && !Number.isFinite(ng) && !Number.isFinite(wa)) return;
            cands.push({
                deed, caseNo, year: String(key.law_suit_year ?? "").trim(),
                order: `${key.fbidnum ?? ""}-${key.fsubbidnum ?? ""}`,
                tambon: String(key.deedtumbol ?? "").trim(),
                amphur: String(key.deedampur ?? "").trim(),
                title, size: `${key.rai ?? ""}-${key.quaterrai ?? ""}-${key.wa ?? ""}`,
                sqWa: [rai, ng, wa].reduce((a, v, i) => a + (Number.isFinite(v) ? v : 0) * [400, 100, 1][i], 0),
            });
        });

        /* One LED row can name twenty deeds and they share a case number, so
         * the cases are the unit: for each, its deeds are tried until one is
         * the land LED described. Otherwise a single row would spend twenty
         * lookups for nothing. */
        const byCase = new Map();
        for (const c of cands) {
            const key = c.caseNo + "/" + c.year;
            if (!byCase.has(key)) byCase.set(key, []);
            byCase.get(key).push(c);
        }

        for (const [, list] of byCase) {
            if (shown >= PER) break;
            for (const c of list) {
                tried++;
                td.setProvince(tdProv);
                const r = await td({ deed_number: c.deed, province_code: tdProv });

                const hits = [];
                for (const row of (r.rows ?? [])) {
                    if (String(row.amphurName ?? "").trim() !== c.amphur) continue;
                    const cad = await officialArea({
                        chanod: c.deed, provinceCode: tdProv,
                        amphurName: row.amphurName, tumbonName: row.tambonName,
                    });
                    const same = cad.sqWa != null && Math.abs(cad.sqWa - c.sqWa) <= Math.max(1, c.sqWa * 0.05);
                    hits.push({ row, cad, same });
                }
                const best = hits.find((h) => h.same) ?? hits[0];
                if (!best || best.row.utmEasting == null) continue;
                const row = best.row;
                const srid = row.utmSrid ?? 24048;
                const { rows: rp } = await db.query(
                    `SELECT ST_Y(${raw(srid)})::float8 AS lat, ST_X(${raw(srid)})::float8 AS lon`,
                    [row.utmEasting, row.utmNorthing]);
                const cal = await loadCalibration(db, { srid });
                const tf = calibratedTransform(cal, `ST_MakePoint($1::double precision, $2::double precision)`);
                const { rows: cp } = await db.query(`SELECT ${tf.latExpr}::float8 AS lat, ${tf.lonExpr}::float8 AS lon`, [row.utmEasting, row.utmNorthing]);
                console.log(
                    `   โฉนด ${c.deed.padEnd(8)} ${(c.caseNo + "/" + c.year).padEnd(12)} order ${c.order.padEnd(6)} ` +
                    `${(c.amphur + "/" + c.tambon).padEnd(28)} size ${c.size.padEnd(16)} srid ${srid}  ระวาง ${row.rawang ?? "-"}  land_no ${row.landNo ?? "-"}`,
                );
                console.log(
                    `        raw        ${Number(rp[0].lat).toFixed(6)}, ${Number(rp[0].lon).toFixed(6)}` +
                    `      corrected ${Number(cp[0].lat).toFixed(6)}, ${Number(cp[0].lon).toFixed(6)}` +
                    `      (${cal ? `cal ${cal.d_lat_m}m ${cal.d_lon_m}m` : "no calibration"})`,
                );
                console.log(
                    `        area       LED ${c.sqWa} ตร.ว.   cadastre ${best.cad.area ?? "-"} (${best.cad.sqWa ?? "-"})  ${best.same ? "AGREE" : "** do not agree **"}`,
                );
                shown++;
                break;
            }
        }
        page++;
    }
    console.log(`   (${tried} deed(s) tried over ${page - 1} page(s), ${shown} confirmed)`);
}

await td.close?.();
await led.close?.();
await db.end();
