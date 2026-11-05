/* probe_dev.js â€” read-only probes of the NAS DB, ASCII-safe output.
 * Thai text is escaped to \uXXXX so the shell cannot mangle it. */
import pg from 'pg';
import fs from 'fs';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgres://postgres:landmap@192.168.1.137:33200/landmap', max: 3 });
/* Write straight to a UTF-8 file â€” stdout mangles Thai through PowerShell. */
const FILE = process.env.PROBE_OUT || `test/out/probe_${Date.now()}.json`;
const out = {};
const show = (label, rows) => { out[label] = rows; };
process.on('exit', () => { fs.writeFileSync(FILE, JSON.stringify(out, null, 1), 'utf8'); });

const what = process.argv[2];

if (what === 'schema') {
  await show('rounds cols', (await pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='auction_rounds' ORDER BY ordinal_position`)).rows);
  await show('lots cols', (await pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='auction_lots' ORDER BY ordinal_position`)).rows);
} else if (what === 'ns3k') {
  await show('ns3k parcels', (await pool.query(`SELECT count(*)::int n FROM parcels WHERE land_title ILIKE '%à¸™.à¸ª.3à¸%'`)).rows);
  await show('ns3k with lots', (await pool.query(`SELECT count(*)::int n FROM parcels p JOIN auction_lots l ON l.parcel_id=p.id WHERE p.land_title ILIKE '%à¸™.à¸ª.3à¸%'`)).rows);
  await show('title values', (await pool.query(`SELECT land_title, count(*)::int n FROM parcels GROUP BY 1 ORDER BY n DESC LIMIT 8`)).rows);
} else if (what === 'contam') {
  /* à¸œà¸š.2255/2562 deed 166919 â€” the two interleaved cycles */
  await show('lots', (await pool.query(`
    SELECT l.id, l.order_label, l.first_round_date::text fd, l.sold_price,
      (SELECT count(*)::int FROM auction_rounds r WHERE r.lot_id=l.id) rounds
    FROM auction_lots l WHERE l.case_no='à¸œà¸š.2255' AND l.case_year=2562`)).rows);
  await show('round rows', (await pool.query(`
    SELECT r.lot_id, r.idx, r.round_date::text d, r.status_code, r.status_label, r.price, r.sold_price,
           r.scraped_at IS NULL AS noscrape
    FROM auction_rounds r JOIN auction_lots l ON l.id=r.lot_id
    WHERE l.case_no='à¸œà¸š.2255' AND l.case_year=2562
    ORDER BY r.lot_id, r.round_date NULLS LAST LIMIT 40`)).rows);
} else if (what === 'roundsource') {
  /* rounds the ingest never wrote (scraped_at NULL) â€” report-inserted rows */
  await show('report-inserted count', (await pool.query(`SELECT count(*)::int n FROM auction_rounds WHERE scraped_at IS NULL`)).rows);
  await show('codes on them', (await pool.query(`SELECT status_code, count(*)::int n FROM auction_rounds WHERE scraped_at IS NULL GROUP BY 1 ORDER BY n DESC`)).rows);
} else if (what === 'sold') {
  await show('close reasons', (await pool.query(`SELECT close_reason, count(*)::int n FROM auction_lots GROUP BY 1 ORDER BY n DESC`)).rows);
  await show('sold lots with lot price', (await pool.query(`
    SELECT count(*)::int n FROM auction_lots l
    WHERE l.close_reason='sold' AND l.sold_price IS NOT NULL AND l.sold_price<>0`)).rows);
  await show('sold lots, no lot price, code1 exists', (await pool.query(`
    SELECT count(*)::int n FROM auction_lots l
    WHERE l.close_reason='sold' AND (l.sold_price IS NULL OR l.sold_price=0)
      AND EXISTS (SELECT 1 FROM auction_rounds r WHERE r.lot_id=l.id AND r.status_code=1)`)).rows)
  await show('code1 rounds with own sold_price', (await pool.query(`
    SELECT count(*)::int n FROM auction_rounds r WHERE r.status_code=1 AND r.sold_price IS NOT NULL AND r.sold_price<>0`)).rows);
  await show('code1 rounds with price', (await pool.query(`
    SELECT count(*)::int n FROM auction_rounds r WHERE r.status_code=1 AND r.price IS NOT NULL AND r.price<>0`)).rows)
  const sample = (await pool.query(`
    SELECT l.id lot_id, l.deed_number, l.close_reason, l.sold_price lot_sp,
           r.status_code, r.round_date::text d, r.price r_price, r.sold_price r_sp, r.status_label
      FROM auction_lots l JOIN auction_rounds r ON r.lot_id=l.id
     WHERE l.close_reason='sold' AND r.status_code=1
     ORDER BY l.id LIMIT 6`)).rows;
  await show('sold sample', sample);
  await show('published nulls', (await pool.query(`
    SELECT count(*)::int n, count(*) FILTER (WHERE published_date IS NULL)::int no_pub FROM auction_lots`)).rows);
  await show('active w/o published', (await pool.query(`
    SELECT count(*)::int n FROM auction_lots WHERE status='active' AND published_date IS NULL`)).rows)
} else if (what === 'dupdate') {
  /* one lot holding more than one round on the same date (accumulation) */
  await show('dup dates', (await pool.query(`
    SELECT lot_id, round_date::text d, count(*)::int n FROM auction_rounds
    WHERE round_date IS NOT NULL GROUP BY 1,2 HAVING count(*)>1 LIMIT 10`)).rows);
  await show('permuted idx', (await pool.query(`
    SELECT count(*)::int n FROM auction_rounds r
    WHERE scraped_at IS NULL AND idx > 0`)).rows);
} else if (what === 'counts') {
  await show('parcel count', (await pool.query(`SELECT count(*)::int n FROM parcels`)).rows);
  await show('lot count', (await pool.query(`SELECT count(*)::int n FROM auction_lots`)).rows);
  await show('round count', (await pool.query(`SELECT count(*)::int n FROM auction_rounds`)).rows);
  await show('lot statuses', (await pool.query(`SELECT status, count(*)::int n FROM auction_lots GROUP BY 1 ORDER BY n DESC`)).rows);
  await show('close codes', (await pool.query(`SELECT close_code, count(*)::int n FROM auction_lots GROUP BY 1 ORDER BY n DESC`)).rows);
  await show('round codes', (await pool.query(`SELECT status_code, count(*)::int n FROM auction_rounds GROUP BY 1 ORDER BY n DESC`)).rows);
  await show('sold_price col', (await pool.query(`SELECT (sold_price IS NOT NULL AND sold_price<>0) has, count(*)::int FROM auction_lots GROUP BY 1`)).rows);
  await show('round dates', (await pool.query(`SELECT (round_date IS NULL) undated, count(*)::int FROM auction_rounds GROUP BY 1`)).rows);
} else {
  console.log('usage: bun test/probe_dev.js schema|ns3k|contam|roundsource|sold|dupdate|counts â€” output: ' + FILE);
}
pool.end();
