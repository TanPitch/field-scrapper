/* richText.test.js — the client half of the annotation styling.
 *
 *   bun richText.test.js        (from test/; no database needed)
 *
 * server/users.js validates the style on the way in. This covers the way out:
 * styleToCss is what puts user-supplied values into a React style attribute, so
 * it is the real injection surface. If a bad value ever reaches it, it must be
 * dropped rather than escaped-and-hoped-for.
 */
import assert from "node:assert/strict";
import { isColor, normStyle, styleToCss, isPlain, BADGE_CHOICES } from "../src/lib/richText.ts";

let passed = 0;
const test = async (name, fn) => {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; }
};

/* ------------------------------------------------------- colour rejection */

await test("accepts the colour forms a user would actually pick", () => {
  for (const c of ["#fff", "#FFFFFF", "#b8f13f", "red", "royalblue", "rgb(1, 2, 3)"]) {
    assert.equal(isColor(c), true, `${c} should be accepted`);
  }
});

await test("rejects CSS injection attempts", () => {
  const bad = [
    "red; background:url(http://evil/x.png)",
    "expression(alert(1))",
    "url(javascript:alert(1))",
    "#fff\" onmouseover=\"alert(1)",
    "</style><script>alert(1)</script>",
    "var(--x)",
    "calc(1+1)",
    "",
    null,
    123,
    {},
  ];
  for (const b of bad) assert.equal(isColor(b), false, `${JSON.stringify(b)} must be rejected`);
});

/* ------------------------------------------------------------- normStyle */

await test("normStyle keeps only the six known keys", () => {
  assert.deepEqual(
    normStyle({ b: true, i: true, u: true, bg: "#f00", fg: "#00ff00", badge: "●" }),
    { b: true, i: true, u: true, bg: "#f00", fg: "#00ff00", badge: "●" },
  );
  assert.deepEqual(normStyle({ evil: "x", onClick: "y", dangerouslySetInnerHTML: {} }), {});
});

await test("normStyle drops a bad colour instead of normalising it", () => {
  assert.deepEqual(normStyle({ bg: "red; position:fixed" }), {});
  assert.deepEqual(normStyle({ fg: "<img src=x onerror=alert(1)>" }), {});
});

await test("normStyle caps the badge so a label cannot flood its cell", () => {
  assert.deepEqual(normStyle({ badge: "abcdefghij" }), { badge: "abcd" });
  assert.deepEqual(normStyle({ badge: 12345 }), {});
});

await test("normStyle coerces flags to real booleans", () => {
  assert.deepEqual(normStyle({ b: "yes", i: 1, u: 0 }), { b: true, i: true, u: false });
});

await test("normStyle survives every kind of junk", () => {
  for (const junk of [null, undefined, 0, "", "str", [], [1, 2], () => {}]) {
    assert.deepEqual(normStyle(junk), {});
  }
});

/* ------------------------------------------------------------ styleToCss */

await test("styleToCss emits flags and colours", () => {
  const css = styleToCss({ b: true, i: true, u: true, bg: "#123456", fg: "#abcdef" });
  assert.equal(css.fontWeight, 700);
  assert.equal(css.fontStyle, "italic");
  assert.equal(css.textDecoration, "underline");
  assert.equal(css.backgroundColor, "#123456");
  /* fg is dropped when a background is set, so the text cannot be painted the
     same colour as its own background and become invisible. */
  assert.equal(css.color, undefined);
});

await test("styleToCss still applies fg with no background", () => {
  assert.equal(styleToCss({ fg: "#ff0000" }).color, "#ff0000");
});

await test("styleToCss emits nothing dangerous from a hostile style", () => {
  const css = styleToCss(normStyle({
    bg: "red; position:fixed; top:0; left:0; width:100vw; height:100vh",
    fg: "url(javascript:alert(1))",
  }));
  assert.deepEqual(css, {}, "hostile values must not survive into css");
});

await test("styleToCss ignores the badge — it is content, not styling", () => {
  const css = styleToCss({ badge: "💰" });
  assert.deepEqual(css, {});
});

await test("isPlain correctly detects unstyled annotations", () => {
  assert.equal(isPlain(undefined), true);
  assert.equal(isPlain(null), true);
  assert.equal(isPlain({}), true);
  assert.equal(isPlain({ evil: 1 }), true, "unknown keys should not count as styling");
  assert.equal(isPlain({ b: true }), false);
  assert.equal(isPlain({ badge: "●" }), false);
});

await test("badge choices are short and single-cell safe", () => {
  assert.ok(BADGE_CHOICES.length >= 8);
  for (const b of BADGE_CHOICES) {
    assert.ok([...b].length <= 4, `${b} is too long`);
  }
});

console.log(`\n${passed} passed${process.exitCode ? ", with failures" : ""}`);
