/* liveDataVerdict.test.js — the gate that decides which scraped parcels reach
 * the map.
 *
 *   cd test; bun liveDataVerdict.test.js      (no database needed)
 *
 * loadParcels filters on tdVerdict/dolVerdict, and those two fields used to be
 * dropped by featureToParcel on the way in. Every read was therefore undefined,
 * `verdictsKnown` was permanently false, and the filter never ran — so the 465
 * parcels with no coordinate of any kind were published and drawn at lat/lng 0,
 * a marker in the Gulf of Guinea. This pins the mapping and the drop.
 */
import assert from "node:assert/strict";

/* Stub before importing: liveData reads the API through lib/api's fetch. */
const feature = (id, props, coordinates) => ({
  type: "Feature",
  geometry: coordinates ? { type: "Point", coordinates } : null,
  properties: {
    id, lotId: id, status: "sale", rounds: [], images: [], imageCount: 0,
    provinceName: "ภูเก็ต", districtName: "เมือง", wah: 100,
    ...props,
  },
});

globalThis.fetch = async () => new Response(JSON.stringify({
  features: [
    /* resolved, has a coordinate: the one row the user should see */
    feature(1, { tdVerdict: "match" }, [98.4, 7.8]),
    /* TD said no_result and no source gave it a point */
    feature(2, { tdVerdict: "no_result" }, null),
    /* a match, but nothing to plot - the Phuket deed 3722 case */
    feature(3, { tdVerdict: "match" }, null),
    /* the wrong district's parcel, so not the one that was asked for */
    feature(4, { tdVerdict: "district_mismatch" }, [100.1, 13.5]),
  ],
}), { status: 200, headers: { "content-type": "application/json" } });

const { loadParcels, ALL_PARCELS, featureToParcel } = await import("../src/data/liveData.ts");

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; }
};

await test("featureToParcel carries the resolver verdicts through", () => {
  const p = featureToParcel(feature(9, { tdVerdict: "match", dolVerdict: "pending_quota" }, [98, 7]), Date.now());
  assert.equal(p.tdVerdict, "match");
  assert.equal(p.dolVerdict, "pending_quota");
});

await test("an unsent verdict becomes null, not undefined", () => {
  const p = featureToParcel(feature(9, {}, [98, 7]), Date.now());
  assert.equal(p.tdVerdict, null);
  assert.equal(p.dolVerdict, null);
});

await test("loadParcels drops every row that cannot be a marker", async () => {
  const r = await loadParcels();
  assert.equal(r.kind, "api");
  assert.deepEqual(ALL_PARCELS.map((p) => p.id), [1]);
  assert.equal(r.hidden, 3, "the three unshowable rows are counted, not silently lost");
});

console.log(`\n${passed} passed${process.exitCode ? ", with failures" : ""}`);
