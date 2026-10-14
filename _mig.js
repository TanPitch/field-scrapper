import fs from "fs";
const { SQL } = await import("bun");
const db = new SQL(process.env.DATABASE_URL);
await db.unsafe(fs.readFileSync("db/migrations/013_lot_identity.sql", "utf8"));
const r = await db.unsafe(`SELECT indexdef FROM pg_indexes WHERE indexname='lots_natural_key'`);
console.log("  new index:\n    " + r[0].indexdef);
const n = await db.unsafe(`SELECT count(*) n, count(deed_number) with_deed, count(DISTINCT deed_number) distinct_deed FROM auction_lots`);
console.log(`  lots=${n[0].n}  with_deed=${n[0].with_deed}  distinct_deed=${n[0].distinct_deed}`);
await db.close();