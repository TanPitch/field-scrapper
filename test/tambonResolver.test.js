/* Tests for tambonResolver — the name→code join that decides whether an
 * auction lot gets an appraisal bracket. Wrong codes here would silently attach
 * the wrong neighbourhood's prices to a lot, so the edge cases matter more than
 * the happy path. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { TambonResolver, normalizeTambon, stripQualifier } from "./tambonResolver.js";

/* Real rows taken from eva_area_grade for Khon Kaen, including the two
   complications: municipality-prefixed names and the code-99 duplicate. */
const KK = [
    { changwat_code: "40", amphur_code: "16", tambon_code: "17", tambon_name: "ภูเวียง" },
    { changwat_code: "40", amphur_code: "16", tambon_code: "99", tambon_name: "เทศบาลตำบลภูเวียง" },
    { changwat_code: "40", amphur_code: "16", tambon_code: "1", tambon_name: "บ้านเรือ" },
    { changwat_code: "40", amphur_code: "16", tambon_code: "4", tambon_name: "หว้าทอง" },
    { changwat_code: "40", amphur_code: "05", tambon_code: "8", tambon_name: "หนองไผ่" },
    { changwat_code: "40", amphur_code: "05", tambon_code: "1", tambon_name: "ชุมแพ" },
    { changwat_code: "40", amphur_code: "07", tambon_code: "9", tambon_name: "กุดน้ำใส" },
    { changwat_code: "40", amphur_code: "07", tambon_code: "1", tambon_name: "น้ำพอง" },
    /* โนนสะอาด really does appear under two amphur codes */
    { changwat_code: "40", amphur_code: "04", tambon_code: "5", tambon_name: "โนนสะอาด" },
    { changwat_code: "40", amphur_code: "13", tambon_code: "2", tambon_name: "โนนสะอาด" },
    { changwat_code: "40", amphur_code: "01", tambon_code: "4", tambon_name: "ท่าพระ" },
];

const r = () => new TambonResolver(KK).indexStems();

test("normalizeTambon strips the municipal prefix กรมธนารักย์ uses", () => {
    assert.equal(normalizeTambon("เทศบาลตำบลภูเวียง"), "ภูเวียง");
    assert.equal(normalizeTambon("เทศบาลนครขอนแก่น"), "ขอนแก่น");
    assert.equal(normalizeTambon("อบต.บ้านดุง"), "บ้านดุง");
    assert.equal(normalizeTambon("หนองไผ่"), "หนองไผ่");
    assert.equal(normalizeTambon(null), "");
});

test("normalizeTambon collapses internal whitespace", () => {
    assert.equal(normalizeTambon("หนอง ไผ่"), "หนองไผ่");
    assert.equal(normalizeTambon("  หว้าทอง "), "หว้าทอง");
});

test("stripQualifier drops a parenthetical sub-area", () => {
    assert.equal(stripQualifier("บ้านดุง (บางสะแก)"), "บ้านดุง");
});

test("resolves a plain LED tambon name to its official code", () => {
    const hit = r().resolve("40", "16", "บ้านเรือ");
    assert.ok(hit);
    assert.equal(hit.code, "1");
    assert.equal(hit.match, "exact");
});

test("prefers the real tambon over its code-99 municipality duplicate", () => {
    assert.equal(r().resolve("40", "16", "ภูเวียง").code, "17"); // not "99"
});

test("matches an LED name against a prefixed official name", () => {
    const resolver = new TambonResolver([
        { changwat_code: "10", amphur_code: "05", tambon_code: "42", tambon_name: "เทศบาลตำบลบางรัก" },
    ]).indexStems();
    assert.equal(resolver.resolve("10", "05", "บางรัก").code, "42");
});

test("scopes by amphur so a repeated tambon name is not confused", () => {
    const resolver = r();
    assert.equal(resolver.resolve("40", "04", "โนนสะอาด").code, "5");
    assert.equal(resolver.resolve("40", "13", "โนนสะอาด").code, "2");
});

test("returns null rather than guessing when the name is unknown", () => {
    assert.equal(r().resolve("40", "16", "ไม่มีอยู่จริง"), null);
});

test("returns null when the amphur has no data", () => {
    assert.equal(r().resolve("40", "99", "บ้านเรือ"), null);
});

test("returns null when required keys are missing", () => {
    const resolver = r();
    assert.equal(resolver.resolve(null, "16", "บ้านเรือ"), null);
    assert.equal(resolver.resolve("40", null, "บ้านเรือ"), null);
    assert.equal(resolver.resolve("40", "16", null), null);
    assert.equal(resolver.resolve("40", "16", ""), null);
});

test("resolves the real LED Khon Kaen sample rows", () => {
    const resolver = r();
    assert.equal(resolver.resolve("40", "05", "หนองไผ่").code, "8");
    assert.equal(resolver.resolve("40", "07", "กุดน้ำใส").code, "9");
});

test("does not match a tambon from the wrong province", () => {
    assert.equal(r().resolve("41", "16", "บ้านเรือ"), null);
});
