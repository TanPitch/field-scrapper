import pg from 'pg';
import fs from 'fs';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  await pool.query(fs.readFileSync('db/migrations/035_report_resync.sql', 'utf8'));
  const kept = await pool.query(`SELECT count(*)::int AS n FROM auction_lots WHERE led_report_seen IS NOT NULL`);
  const open = await pool.query(`SELECT count(*)::int AS n FROM auction_lots WHERE led_report_seen IS NULL AND case_no <> '' AND case_year IS NOT NULL`);
  console.log('stamped lots kept:', kept.rows[0].n, '| unstamped (will re-sync):', open.rows[0].n);
} catch (e) { console.error('FAILED:', e.message); process.exitCode = 1; }
await pool.end();