import pg from 'pg';
import fs from 'fs';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  await pool.query(fs.readFileSync('db/migrations/033_editor_images.sql', 'utf8'));
  const r = await pool.query(`SELECT column_name FROM information_schema.columns
     WHERE table_name IN ('lot_images','parcel_edits') AND column_name IN ('sort_no','ref_id') ORDER BY 1`);
  console.log('columns added:', r.rows.map((x) => x.column_name));
  const k = await pool.query(`SELECT conname FROM pg_constraint WHERE conrelid = 'lot_images'::regclass AND contype='u'`);
  console.log('uniques:', k.rows.map((x) => x.conname));
} catch (e) {
  console.error('FAILED:', e.message);
  process.exitCode = 1;
}
await pool.end();
