/* Ground truth captured from the user's manual check on 2026-10-12.
 *
 * They looked up six Khon Kaen deeds on both กรมที่ดิน (LandsMaps) and
 * กรมธนารักย์ (assessprice), recording the true parcel coordinate, the true
 * ไร่-งาน-ตร.วา and the true per-parcel ราคาประเมิน บาท/ตร.วา.
 *
 * This is the ONLY per-parcel ราคาประเมิน we hold anywhere, and it came from a
 * human checking six lots by hand. Worth keeping: it is the yardstick for
 * (a) how far a subdistrict marker sits from the real parcel, and
 * (b) how badly our free area-level bracket can miss.
 *
 * Stored with provenance so it is never mistaken for a scraped value.
 */
import pg from "pg";

/** deed_number, lat, lon, rai, ngan, wa, appraisal ฿/ตร.วา, verified_by */
export const GROUND_TRUTH = [
    { deed: "32880",  lat: 16.4227, lon: 102.8335, rai: 0, ngan: 0, wa: 56.4,  eva: 80500 },
    { deed: "72927",  lat: 16.4225, lon: 102.8014, rai: 0, ngan: 1, wa: 9.4,   eva: 4000 },
    { deed: "79626",  lat: 16.3931, lon: 102.8244, rai: 0, ngan: 0, wa: 30.0,  eva: 13500 },
    { deed: "66383",  lat: 16.7193, lon: 102.8176, rai: 7, ngan: 0, wa: 19.0,  eva: 490 },
    { deed: "35089",  lat: 16.6880, lon: 103.1353, rai: 3, ngan: 3, wa: 65.9,  eva: 410 },
    { deed: "11093",  lat: 16.2674, lon: 102.7133, rai: 7, ngan: 0, wa: 10.0,  eva: 120 },
];

/** Great-circle distance in km. */
export function haversineKm(a, b) {
    const R = 6371;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const s =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
}

if (import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1]).href) {
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();

    await client.query(`
        INSERT INTO data_sources (key, name, agency, url, license, notes) VALUES
        ('manual_verified', 'ตรวจสอบโดยผู้ใช้ (manual ground truth)', 'human', NULL, NULL,
         'Six Khon Kaen deeds checked by hand against LandsMaps + assessprice on 2026-10-12. Not scraped.')
        ON CONFLICT (key) DO UPDATE SET notes = EXCLUDED.notes`);

    const { rows } = await client.query(`
        SELECT p.id, p.deed_number, p.tumbol, p.district_name,
               ST_Y(p.geom::geometry) AS lat, ST_X(p.geom::geometry) AS lon,
               p.eva_price_min, p.eva_price_max, p.eva_price_avg, p.eva_grade_count
          FROM parcels p
         WHERE p.deed_number = ANY($1)`, [GROUND_TRUTH.map((g) => g.deed)]);

    const byDeed = new Map(rows.map((r) => [r.deed_number, r]));

    console.log("deed     ตำบล        ours -> truth        offset   our bracket ฿/ตร.วา   truth   verdict");
    console.log("-".repeat(104));

    const rowsOut = [];
    for (const g of GROUND_TRUTH) {
        const r = byDeed.get(g.deed);
        if (!r) { console.log(`${g.deed.padEnd(8)} (not in database)`); continue; }

        const km = haversineKm({ lat: Number(r.lat), lon: Number(r.lon) }, g);
        const bracket = r.eva_price_min === null
            ? "—"
            : `${r.eva_price_min}–${r.eva_price_max}`;
        let verdict = "NO BRACKET";
        if (r.eva_price_min !== null) {
            verdict = g.eva >= Number(r.eva_price_min) && g.eva <= Number(r.eva_price_max)
                ? "inside"
                : `OUTSIDE (${(g.eva / Number(r.eva_price_max)).toFixed(1)}x max)`;
        }
        console.log(
            g.deed.padEnd(8) +
            String(r.tumbol).padEnd(12) +
            `${Number(r.lat).toFixed(4)},${Number(r.lon).toFixed(4)}`.padEnd(18) +
            `${g.lat.toFixed(4)},${g.lon.toFixed(4)}`.padEnd(18) +
            `${km.toFixed(2)}km`.padEnd(9) +
            bracket.padEnd(22) +
            String(g.eva).padEnd(8) +
            verdict,
        );
        rowsOut.push({ km, verdict });
    }

    const kms = rowsOut.map((x) => x.km).sort((a, b) => a - b);
    const inside = rowsOut.filter((x) => x.verdict === "inside").length;
    console.log("-".repeat(104));
    console.log(`marker offset   min ${kms[0].toFixed(2)} km · median ${kms[Math.floor(kms.length / 2)].toFixed(2)} km · max ${kms[kms.length - 1].toFixed(2)} km`);
    console.log(`area bracket    ${inside}/${rowsOut.length} contained the true per-parcel price`);

    // persist the verified values, credited to the human check
    for (const g of GROUND_TRUTH) {
        const r = byDeed.get(g.deed);
        if (!r) continue;
        await client.query(
            `UPDATE parcels SET dol_lat=$2, dol_lon=$3, dol_rai=$4, dol_ngan=$5, dol_wa=$6,
                    dol_land_price=$7, geo_precision='parcel', geo_status='verified',
                    geo_note='manually verified against LandsMaps + assessprice 2026-10-12',
                    geom=ST_SetSRID(ST_MakePoint($3,$2),4326)::geography,
                    dol_checked_at=now()
              WHERE id=$1`,
            [r.id, g.lat, g.lon, g.rai, g.ngan, g.wa, g.eva]);
        for (const [f, v] of [["dol_lat", g.lat], ["dol_lon", g.lon], ["dol_land_price", g.eva]]) {
            await client.query(
                `INSERT INTO field_provenance
                   (entity_type, entity_id, field_name, source_key, observed_on, value_num)
                 VALUES ('parcel',$1,$2,'manual_verified',CURRENT_DATE,$3)
                 ON CONFLICT (entity_type, entity_id, field_name, source_key, observed_on)
                 DO UPDATE SET value_num=EXCLUDED.value_num`,
                [r.id, f, v]);
        }
    }
    console.log("\nverified values stored with source 'manual_verified'");
    await client.end();
}
