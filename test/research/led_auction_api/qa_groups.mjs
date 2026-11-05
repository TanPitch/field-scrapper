// qa_groups.mjs — item-3 QA: group-sale (ขายรวม) metadata quality.
//   Q1  every deed number named in a group remark resolves to a lot that sits
//       under the SAME case+year+order (a ref pointing outside the group is a
//       parse artefact and shows up as a wrong sibling on click)
//   Q2  group keys where only SOME lots carry the remark/count (half-tagged
//       groups still work client-side via the order key, but the ring would
//       name a sibling that disagrees with its own row)
//   Q3  remark says "รวม N แปลง" and group_lot_count says M — do they agree?
// Run: DATABASE_URL=postgres://postgres:landmap@localhost:5433/landmap bun qa_groups.mjs
//
import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://postgres:landmap@localhost:5433/landmap",
});

const deedRefs = (remark) =>
  [...remark.matchAll(/โฉนด[^ ]*\s*เลขที่\s*([0-9,\s]{4,})/g)]
    .flatMap((m) => m[1].split(/[,\s]+/).filter(Boolean));

const groups = (await pool.query(`
  SELECT id, case_no, case_year, order_label, group_lot_count, deed_number::text AS deed, remark
    FROM auction_lots
   WHERE remark LIKE '%ขายรวม%'
  ORDER BY case_no, case_year, order_label, id`)).rows;

/* Key all lots once — refs must be checked against the real sibling set, and
   a ref may validly name a sibling that has NO remark itself (Q2's shape). */
const all = (await pool.query(`
  SELECT id, case_no, case_year, order_label, deed_number::text AS deed
    FROM auction_lots`)).rows;
const keyOf = (r) => [r.case_no, r.case_year, r.order_label].join("|");
const byKey = new Map();
for (const r of all) {
  const k = keyOf(r);
  if (!byKey.has(k)) byKey.set(k, new Map());
  byKey.get(k).set(r.deed, r);
}

let externalRefs = 0;
const extSample = [];
for (const row of groups) {
  for (const d of deedRefs(row.remark ?? "")) {
    if (!row.deed) continue; /* no deed on this lot — can't anchor */
    const k = keyOf(row);
    if (byKey.get(k)?.has(d)) continue; /* named a sibling in the same group */
    /* maybe one of the OTHER keys of the same case carries it (order_label
       differs per re-list) — count those separately as re-list refs */
    const deport = [...byKey.entries()].some(([k, m]) => !k.startsWith(`${row.case_no}|${row.case_year}|`) ? false : m.has(d));
    if (!deport) {
      externalRefs++;
      if (extSample.length < 6)
        extSample.push([row.case_no, row.case_year, row.order_label, row.remark.slice(0, 50), d]);
    }
  }
}

/* Q2 — partial groups: a key where group signal exists on SOME rows only. */
let partialKeys = 0;
const partSample = [];
for (const [k, m] of byKey) {
  const rows = [...m.values()];
  const flagged = groups.filter((g) => keyOf(g) === k).length;
  if (flagged > 0 && flagged < rows.length) {
    partialKeys++;
    if (partSample.length < 5) partSample.push([k, flagged, rows.length]);
  }
}

/* Q3 — remark N vs group_lot_count. ผบ.2545's own form: "รวม 3 แปลง". */
let disagree = 0;
const disSample = [];
for (const row of groups) {
  const m = row.remark?.match(/รวม\s*(\d+)\s*แปลง/);
  if (!m || row.group_lot_count == null) continue;
  if (Number(m[1]) !== row.group_lot_count) {
    disagree++;
    if (disSample.length < 5) disSample.push([row.case_no, row.case_year, m[1], row.group_lot_count]);
  }
}

console.log(`group rows: ${groups.length}`);
console.log(`Q1 external deed refs: ${externalRefs}`);
for (const s of extSample) console.log("   ", s.join(" | "));
console.log(`Q2 partially-tagged group keys: ${partialKeys}`);
for (const s of partSample) console.log("   ", s.join(" | "));
console.log(`Q3 remark N != group_lot_count: ${disagree}`);
for (const s of disSample) console.log("   ", s.join(" | "));
await pool.end();
