/* districtResolve.test.js — finding the district a scraped row names.
 *
 *   DATABASE_URL=... bun test districtResolve.test.js
 *
 * LED does not always file a district under the province it belongs to: the
 * dropdown for ปราจีนบุรี also lists สระแก้ว's districts, and it spells the
 * district seat "สระแก้ว" where the สระแก้ว dropdown spells it "เมืองสระแก้ว". A
 * lookup scoped to the scraped province missed those, and the parcels behind them
 * were dropped with nothing but a counter to show for it.
 */
import { test, expect, afterAll } from "bun:test";
import pg from "pg";
import { ledDistrictByName } from "./tdDict.js";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

/** The resolver, as ingest.js uses it. */
const resolveDistrict = async (provinceCode, name) => {
  const local = await client.query(
    `SELECT id, dol_code, province_id FROM districts WHERE province_id = $1 AND name = $2 LIMIT 1`,
    [provinceCode, name]);
  if (local.rows[0]) return local.rows[0];
  const dd = ledDistrictByName(name);
  if (!dd?.tdDistrictCode) return null;
  const global = await client.query(
    `SELECT id, dol_code, province_id FROM districts
      WHERE td_province_code = $1 AND td_code = $2 LIMIT 1`,
    [Number(dd.tdProvinceCode), Number(dd.tdDistrictCode)]);
  return global.rows[0] ?? null;
};

test("a district filed under the wrong province is still found", async () => {
  /* สระแก้ว's districts are listed in ปราจีนบุรี's dropdown. Scoped to LED
     province 25, "วังน้ำเย็น" is nowhere to be found. */
  const scoped = await client.query(
    `SELECT 1 FROM districts WHERE province_id = 25 AND name = 'วังน้ำเย็น'`);
  expect(scoped.rows.length).toBe(0);

  const d = await resolveDistrict(25, "วังน้ำเย็น");
  expect(d).not.toBeNull();
  /* And it comes back as the district it really is, not as a ปราจีนบุรี one. */
  expect(Number(d.province_id)).toBe(27);
  expect(Number(d.dol_code)).toBe(4);
});

test("the district seat LED spells two ways resolves to the same district", async () => {
  /* LED's ปราจีนบุรี dropdown says "สระแก้ว", its สระแก้ว dropdown says
     "เมืองสระแก้ว". Both are the same land, and the dictionary knows it. */
  const a = await resolveDistrict(25, "สระแก้ว");
  const b = await resolveDistrict(27, "เมืองสระแก้ว");
  expect(a).not.toBeNull();
  expect(b).not.toBeNull();
  expect(Number(a.id)).toBe(Number(b.id));
  expect(Number(a.dol_code)).toBe(1);
});

test("a district in its own province still resolves the same way", async () => {
  const d = await resolveDistrict(40, "เมืองขอนแก่น");
  expect(d).not.toBeNull();
  expect(Number(d.province_id)).toBe(40);
});

test("a name two provinces share is not guessed", async () => {
  /* "ปากคาด" is in both ตรัง and บึงกาฬ. Scoped to one province it is
     found; the global fallback must not silently pick the other. */
  const d = await resolveDistrict(43, "ปากคาด");
  expect(d).not.toBeNull();
  expect(Number(d.province_id)).toBe(43);
});

afterAll(async () => { await client.end(); });