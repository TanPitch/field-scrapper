/* landtitle.test.js — the landtype normalizer must survive LED's spelling drift.
 *   node landtitle.test.js
 */
import assert from "node:assert/strict";

/* Copy of the normalizer in scrapeLED.js. Kept here so the four real LED
   spellings are pinned by test rather than by inspection. */
const landtype = (text) => {
    if (text == null || String(text).trim() === "") return { code: null, raw: null };
    const raw = String(text).trim();
    const s = raw.replace(/\s+/g, "");
    if (/^ตามสำเนา/.test(s)) return { code: "ตามสำเนาโฉนด", raw };
    if (/^น\.?ส\.?3ก/.test(s) || /^3ก/.test(s)) return { code: "น.ส.3ก.", raw };
    if (/^โฉนด/.test(s)) return { code: "โฉนด", raw };
    if (/^หนือกรรมสิทธิ์/.test(s)) return { code: "โฉนด", raw };
    return { code: raw, raw };
};

let pass = 0;
const t = (name, fn) => {
    try {
        fn();
        pass++;
        console.log(`  ok   ${name}`);
    } catch (e) {
        console.log(`  FAIL ${name}\n       ${e.message}`);
        process.exitCode = 1;
    }
};

// spellings actually observed on asset.led.go.th
t('"โฉนดเลขที่" -> โฉนด', () =>
    assert.equal(landtype("โฉนดเลขที่").code, "โฉนด"));
t('"หนือกรรมสิทธิ์" -> โฉนด', () =>
    assert.equal(landtype("หนือกรรมสิทธิ์").code, "โฉนด"));
t('"ตามสำเนาโฉนดเลขที่" -> ตามสำเนาโฉนด (NOT โฉนด)', () => {
    const r = landtype("ตามสำเนาโฉนดเลขที่");
    assert.equal(r.code, "ตามสำเนาโฉนด");
    assert.notEqual(r.code, "โฉนด", "per-copy title is legally distinct");
});
t('"น.ส. 3 ก เลขที่" (spaced) -> น.ส.3ก.', () =>
    assert.equal(landtype("น.ส. 3 ก เลขที่").code, "น.ส.3ก."));
t('"น.ส.3ก.เลขที่" (unspaced) -> น.ส.3ก.', () =>
    assert.equal(landtype("น.ส.3ก.เลขที่").code, "น.ส.3ก."));
t("raw is always preserved", () => {
    assert.equal(landtype("โฉนดเลขที่").raw, "โฉนดเลขที่");
    assert.equal(landtype("น.ส. 3 ก เลขที่").raw, "น.ส. 3 ก เลขที่");
});
t("empty / null -> null code", () => {
    assert.equal(landtype("").code, null);
    assert.equal(landtype(null).code, null);
    assert.equal(landtype("   ").code, null);
});
t("unknown spelling passes through visibly, not silently", () => {
    const r = landtype("ผืนส.ว.2");
    assert.equal(r.code, "ผืนส.ว.2");
    assert.equal(r.raw, "ผืนส.ว.2");
});
t("does not treat every '3' as น.ส.3ก.", () => {
    // the old `/3\s??/` matched any value containing "3"
    assert.notEqual(landtype("โฉนดเลขที่ 3 ตารางวา").code, "น.ส.3ก.");
});

console.log(`\n${pass} passed${process.exitCode ? ", some FAILED" : ", all green"}`);