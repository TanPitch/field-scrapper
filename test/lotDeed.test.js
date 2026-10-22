/* lotDeed.test.js — the deed number a lot carries.
 *
 *   bun test lotDeed.test.js
 *
 * One LED row can name several deeds. A parcel is made for each, and the lot's
 * natural key is built from the deed number, so a lot stamped with the whole
 * list collapses them onto one row and every parcel but the first is left with
 * no lot - no case number, no size, no price, and nothing to search for on
 * LED's site. 97 parcels were like that.
 */
import { test, expect } from "bun:test";
import { lotDeedNumber } from "./ingest.js";

test("a row naming one deed keeps LED's own string", () => {
    expect(lotDeedNumber({ number: "1234", deeds: { numbers: ["1234"] } }, "1234")).toBe("1234");
});

test("a condominium lot carries the building's deed, not the unit's", () => {
    /* The unit is the plot number; the deed is the building's. */
    expect(lotDeedNumber({ number: "999", deeds: { numbers: ["999"] } }, "999")).toBe("999");
});

test("a row naming several deeds gives each parcel its own number", () => {
    const a = { number: "45722,45727-9", deeds: { numbers: ["45722", "45727", "45728"] } };
    expect(lotDeedNumber(a, "45722")).toBe("45722");
    expect(lotDeedNumber(a, "45727")).toBe("45727");
    expect(lotDeedNumber(a, "45728")).toBe("45728");
    /* and never the whole list, which is what collapsed them */
    expect(lotDeedNumber(a, "45727")).not.toBe("45722,45727-9");
});

test("a missing deed number is null, not an empty string", () => {
    expect(lotDeedNumber({ number: null, deeds: { numbers: [] } }, null)).toBe(null);
});
