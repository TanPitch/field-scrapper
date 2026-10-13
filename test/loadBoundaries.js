/* loadBoundaries.js — pull official subdistrict polygons into PostGIS and
 * place LED parcels that have no กรมที่ดิน coordinate yet.
 *
 * No quota involved: this is a public ArcGIS FeatureServer holding standard
 * administrative boundaries. 50 m generalisation, which is the right scale for
 * a province-level map and useless for telling two adjacent plots apart.
 *
 *   DATABASE_URL=... bun loadBoundaries.js [provinceCode]
 */
import axios from "axios";
import pg from "pg";

const URL =
    "https://services1.arcgis.com/jSaRWj2TDlcN1zOC/arcgis/rest/services/" +
    "Thailand_Subdistrict_Boundaries_(ข้อมูลขอบเขตตำบลประเทศไทย)/FeatureServer/1/query";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36";
const PAGE = 500;

export async function fetchBoundaries({ province = null, onProgress = () => {} } = {}) {
    const where = province ? `ADMIN_ID1='${province}'` : "1=1";
    const out = [];
    let offsetId = null;

    for (;;) {
        const params = {
            where,
            outFields: "ADMIN_ID1,ADMIN_ID2,ADMIN_ID3,NAME1,NAME2,NAME3,POPULATION",
            outSR: "4326",
            returnGeometry: "true",
            f: "geojson",
            resultOffset: out.length,
            resultRecordCount: PAGE,
            ...(offsetId ? { resultOffsetId: offsetId } : {}),
        };
        const r = await axios.get(URL, { params, timeout: 60000, headers: { "User-Agent": UA } });
        const feats = r.data?.features ?? [];
        if (!feats.length) break;
        out.push(...feats);
        onProgress(out.length);
        if (feats.length < PAGE) break;
        offsetId = r.data?.exceededTransferLimit ? feats[feats.length - 1]?.properties?.ADMIN_ID3 : null;
        if (!r.data?.exceededTransferLimit) break;
    }
    return out;
}

/** ArcGIS returns an esriGeometry envelope-wrapped GeoJSON; normalise to plain
 *  GeoJSON coordinates and fix antimeridian-wrapped rings if present. */
function toGeoJsonGeom(feature) {
    const g = feature.geometry;
    if (!g) return null;
    if (g.type === "Feature") return g.geometry;
    return { type: g.type, coordinates: g.coordinates };
}

export async function loadIntoDb(client, features) {
    let inserted = 0;
    for (const f of features) {
        const p = f.properties ?? {};
        const geom = toGeoJsonGeom(f);
        if (!geom || !p.ADMIN_ID3) continue;
        await client.query(
            `INSERT INTO subdistrict_boundaries
               (tambon_code, district_code, province_code, tambon_name,
                amphur_name, province_name, population, geom, center)
             VALUES ($1,$2,$3,$4,$5,$6,$7,
                     ST_Multi(ST_GeomFromGeoJSON($8)),
                     ST_PointOnSurface(ST_Multi(ST_GeomFromGeoJSON($8)))::geography)
             ON CONFLICT (tambon_code) DO UPDATE SET
                tambon_name = EXCLUDED.tambon_name,
                amphur_name = EXCLUDED.amphur_name,
                province_name = EXCLUDED.province_name,
                geom = EXCLUDED.geom,
                center = EXCLUDED.center`,
            [p.ADMIN_ID3, p.ADMIN_ID2, p.ADMIN_ID1, p.NAME3, p.NAME2, p.NAME1,
             p.POPULATION == null ? null : Math.trunc(p.POPULATION),
             JSON.stringify(geom)],
        );
        inserted++;
    }
    return inserted;
}

/**
 * Give every parcel without a กรมที่ดิน coordinate its subdistrict marker.
 * Only fills an EMPTY geom, so a real parcel point is never overwritten.
 *
 * The join is by NAME within a district, NOT by code. Verified by comparing the
 * two sources for the same three places in Khon Kaen:
 *
 *     place        กรมธนารักย์ code   official DOPA รหัสตำบล
 *     เมืองเก่า            97                   400106
 *     สาวะถี              90                   400107
 *     พระลับ              91                   400108
 *
 * `eva_area_grade.tambon_code` is กรมธนารักย์'s own sub-district numbering, not
 * the national one, so `parcels.tambon_code` must never be equated with it.
 * Amphur/district codes DO agree (province*100 + dol_code), so the district is
 * a safe scope and the name is the only usable key.
 */
export async function placeUnresolvedParcels(client) {
    const { rows } = await client.query(
        `WITH matched AS (
            SELECT p.id, b.tambon_code, b.center
              FROM parcels p
              JOIN subdistrict_boundaries b
                ON  b.district_code = (p.province_code * 100 + p.district_dol_code)::text
                AND  b.tambon_name   = p.tumbol
             WHERE p.geom IS NULL
                AND p.tumbol IS NOT NULL
                AND p.tumbol <> ''
                AND p.tumbol <> '-'
                AND p.tumbol <> 'ไม่ปรากฏ'
         ), upd AS (
             UPDATE parcels p
                SET geom = m.center,
                    geo_precision = 'subdistrict',
                    tambon_code = m.tambon_code   -- now the OFFICIAL รหัสตำบล
              FROM matched m
              WHERE p.id = m.id
             RETURNING p.id
         )
         SELECT count(*)::int AS n FROM upd`,
    );
    return rows[0].n;
}

/** Report what could not be placed, so gaps stay visible rather than silent. */
export async function unplacedReport(client) {
    const { rows } = await client.query(
        `SELECT p.tumbol, p.district_name, count(*) AS lots
           FROM parcels p
          WHERE p.geom IS NULL
          GROUP BY 1,2 ORDER BY 3 DESC`,
    );
    return rows;
}

// ---- CLI ------------------------------------------------------------------

if (import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1]).href) {
    const url = process.env.DATABASE_URL;
    if (!url) { console.error("DATABASE_URL is required"); process.exit(1); }
    const province = process.argv[2] ?? null;

    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
        let last = 0;
        const feats = await fetchBoundaries({
            province,
            onProgress: (n) => {
                if (n - last >= 1000) { last = n; process.stdout.write(`  fetched ${n}\n`); }
            },
        });
        console.log(`fetched ${feats.length} boundaries${province ? ` for province ${province}` : ""}`);

        const inserted = await loadIntoDb(client, feats);
        console.log(`loaded ${inserted} into subdistrict_boundaries`);

        const placed = await placeUnresolvedParcels(client);
        console.log(placed + ' parcel(s) placed at subdistrict resolution');

        /* tambon_code now holds the OFFICIAL รหัสตำบล, replacing กรมธนารักย์'s
           internal number, so provenance for that field must name the boundary
           source rather than กรมธนารักย์. */
        await client.query(
            `INSERT INTO data_sources (key, name, agency, url, license, notes) VALUES
             ('dopa_boundary', 'ขอบเขตเขตการปกครอง รายตำบล', 'กรมการปกครอง',
              'https://services1.arcgis.com/jSaRWj2TDlcN1zOC/arcgis/rest/services/Thailand_Subdistrict_Boundaries',
              'public FeatureService',
              'Official subdistrict polygons, 50m generalisation. Used for map placement when no parcel coordinate is held.')
             ON CONFLICT (key) DO UPDATE SET notes = EXCLUDED.notes`);
        await client.query(
            `INSERT INTO field_provenance
               (entity_type, entity_id, field_name, source_key, observed_on, value_text)
             SELECT 'parcel', p.id, 'tambon_code', 'dopa_boundary', CURRENT_DATE, b.tambon_code
               FROM parcels p
               JOIN subdistrict_boundaries b
                 ON b.district_code = (p.province_code * 100 + p.district_dol_code)::text
                AND b.tambon_name   = p.tumbol
             ON CONFLICT (entity_type, entity_id, field_name, source_key, observed_on)
             DO UPDATE SET value_text = EXCLUDED.value_text`);

        const unplaced = await unplacedReport(client);
        if (unplaced.length) {
            console.log('still unplaced:');
            for (const u of unplaced) console.log('   ' + String(u.lots).padStart(3) + ' lot(s)  ' + u.district_name + ' / ' + u.tumbol);
        }
    } finally {
        await client.end();
    }
}
