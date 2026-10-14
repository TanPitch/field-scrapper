const { SQL } = await import("bun");
const db = new SQL(process.env.DATABASE_URL);
const r = await db.unsafe(`SELECT column_name FROM information_schema.columns WHERE table_name='auction_lots' ORDER BY ordinal_position`);
console.log("  " + r.map(x => x.column_name).join(", "));
await db.close();