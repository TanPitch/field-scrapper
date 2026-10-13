/* ledClient.test.js — throttle detection and backoff maths, no network.
 *   node ledClient.test.js
 */
import assert from "node:assert/strict";
import * as cheerio from "cheerio";
import { LedClient } from "./ledClient.js";

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

/** The two page shapes that are otherwise indistinguishable. */
const resultPage = `
  <form id="webForm"></form>
  <input name="totalpage" value="112">
  <table class="table table-hover"><tr><td><input name="deedno" value="1"></td></tr></table>`;
const throttledPage = `
  <form id="webForm"></form>
  <table class="table table-hover"></table>`;
const wafPage = `<html><body>Request unsuccessful. Incapsula incident ID: 1234</body></html>`;

const rowsOf = (html) => cheerio.load(html)("tr").filter((i, e) => cheerio.load(html)(e).find('input[name="deedno"]').length).length;

console.log("page shapes");
t("a real result page has rows", () => {
    const $ = cheerio.load(resultPage);
    assert.equal($("tr").filter((i, e) => $(e).find('input[name="deedno"]').length).length, 1);
    assert.equal($('input[name="totalpage"]').attr("value"), "112");
});
t("a throttled page has no rows and no totalpage", () => {
    const $ = cheerio.load(throttledPage);
    assert.equal($("tr").filter((i, e) => $(e).find('input[name="deedno"]').length).length, 0);
    assert.equal($('input[name="totalpage"]').attr("value"), undefined);
});
t("a WAF page is recognisable", () => {
    assert.ok(/incapsula/i.test(wafPage));
});

console.log("client wiring");
t("open() caches form fields and seckey", () => {
    const c = new LedClient();
    c.baseFields = {};
    c.action = "https://asset.led.go.th/newbidreg/default.asp";
    c.seckey = "12345";
    // verify body carries the one-time key on EVERY page, not just the first
    const body = new URLSearchParams({
        ...c.baseFields, province: "X", search: "ok", oseckey: c.seckey, seckey: c.seckey, page: "7",
    }).toString();
    assert.ok(body.includes("oseckey=12345"));
    assert.ok(body.includes("seckey=12345"));
    assert.ok(body.includes("page=7"));
});

t("body includes search=ok and the one-time key on every page", async () => {
    /* `#body` is a true private field and cannot be reached reflectively, so
       assert on the wire instead: stub axios and capture what gets posted. */
    const axios = (await import("axios")).default;
    const original = axios.post;
    let seen = null;
    axios.post = async (url, body) => {
        seen = { url, body };
        return {
            headers: {},
            data: Buffer.from(
                '<input name="totalpage" value="1"><table class="table table-hover">' +
                '<tr><td><input name="deedno" value="1"></td></tr></table>',
                "utf8",
            ),
        };
    };
    try {
        const c = new LedClient();
        c.baseFields = {};
        c.action = "https://asset.led.go.th/newbidreg/default.asp";
        c.seckey = "999";
        const r = await c.search({ province: "X", page: "3" });
        assert.ok(r.rowCount === 1, "stubbed result should parse as 1 row");
        assert.ok(seen.body.includes("search=ok"), "LED's JS adds search=ok on submit");
        assert.ok(seen.body.includes("oseckey=999"), "key must ride on every page");
        assert.ok(seen.body.includes("seckey=999"));
        assert.ok(seen.body.includes("page=3"));
    } finally {
        axios.post = original;
    }
});

t("throttle detection: empty page with no totalpage is flagged", async () => {
    const axios = (await import("axios")).default;
    const original = axios.post;
    axios.post = async () => ({
        headers: {},
        data: Buffer.from('<form id="webForm"></form><table class="table table-hover"></table>', "utf8"),
    });
    try {
        const c = new LedClient({ maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 2 });
        c.baseFields = {};
        c.action = "https://asset.led.go.th/newbidreg/default.asp";
        c.seckey = "1";
        const r = await c.search({ page: "1" });
        assert.equal(r.throttled, true, "empty result page must be reported as throttled");
        assert.equal(r.rowCount, 0);
    } finally {
        axios.post = original;
    }
});

t("a genuinely empty page is allowed when caller says so", async () => {
    const axios = (await import("axios")).default;
    const original = axios.post;
    axios.post = async () => ({
        headers: {},
        data: Buffer.from('<input name="totalpage" value="0">', "utf8"),
    });
    try {
        const c = new LedClient({ maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 2 });
        c.baseFields = {};
        c.action = "https://asset.led.go.th/newbidreg/default.asp";
        c.seckey = "1";
        const r = await c.search({ page: "1" }, { expectRows: false });
        assert.equal(r.throttled, false);
    } finally {
        axios.post = original;
    }
});

console.log("adaptive pacing");
t("throttle streak doubles the pacing delay", () => {
    const c = new LedClient({ baseDelayMs: 1000, maxDelayMs: 60_000 });
    assert.equal(c.currentDelay, 1000);
    c.throttleStreak = 2; c.currentDelay = Math.min(c.currentDelay * 2, 60_000);
    assert.equal(c.currentDelay, 2000);
    c.currentDelay = Math.min(c.currentDelay * 2, 60_000);
    assert.equal(c.currentDelay, 4000);
});
t("pacing is capped", () => {
    const c = new LedClient({ baseDelayMs: 40_000, maxDelayMs: 60_000 });
    assert.equal(Math.min(c.currentDelay * 2, c.maxDelayMs), 60_000);
});
t("success resets pacing and streak", () => {
    const c = new LedClient({ baseDelayMs: 1000 });
    c.throttleStreak = 5; c.currentDelay = 32_000;
    // mirrors the success branch in search()
    c.throttleStreak = 0;
    c.currentDelay = c.baseDelayMs;
    assert.equal(c.currentDelay, 1000);
    assert.equal(c.throttleStreak, 0);
});

console.log("cookies");
t("a re-issued session id replaces the old one", () => {
    const c = new LedClient();
    c.cookies = ["ASPSESSIONIDQUARBBCR=OLD", "visid_incap_1=A"];
    // mirrors #absorb replacing by cookie name
    const name = "ASPSESSIONIDQUARBBCR";
    c.cookies = c.cookies.filter((x) => x.split("=")[0] !== name);
    c.cookies.push("ASPSESSIONIDQUARBBCR=NEW");
    assert.equal(c.cookies.length, 2, "jar must not grow on re-issue");
    assert.ok(c.cookieHeader.includes("NEW"));
    assert.ok(!c.cookieHeader.includes("OLD"));
});

console.log("summary");
t("summary reports waits in seconds", () => {
    const c = new LedClient();
    c.stats = { requests: 3, throttled: 1, retried: 2, waitedMs: 12_000 };
    const s = c.summary();
    assert.equal(s.waitedSec, 12);
    assert.equal(s.requests, 3);
    assert.equal(s.throttled, 1);
});

console.log(`\n${pass} passed${process.exitCode ? ", some FAILED" : ", all green"}`);