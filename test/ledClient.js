/* ledClient.js — one polite HTTP client for every LED request.
 *
 * Why this exists. LED sits behind Incapsula (the `visid_incap_*` cookie in a
 * captured browser request). Under load it stops returning rows but STILL
 * answers 200 with the search form re-rendered, so "throttled" and "this
 * province genuinely has no lots" are byte-identical unless you look closely.
 * That ambiguity is why a throttled scrape looked like a scraper bug earlier.
 *
 * The rules that follow from that:
 *
 *  - ONE session for the whole run. Every request reuses the cookie handed out
 *    by the first GET, including the one-time `oseckey`.
 *  - Exponential backoff WITH full jitter. Fixed delays synchronise across
 *    retries and hammer the same edge node.
 *  - Adaptive pacing. A run that has been refused gets slower automatically
 *    instead of being retried at the same speed until it succeeds.
 *  - Explicit throttle detection, so a caller can tell "0 lots because none
 *    exist" from "0 lots because we were throttled".
 */
import axios from "axios";
import * as cheerio from "cheerio";
import { decodeHtml } from "./helper.js";

export const LED_BASE = "https://asset.led.go.th/newbidreg/";
const UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36";

const fullJitter = (ms) => Math.floor(Math.random() * ms);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Pages that mean "go slower", not "try again immediately". */
const THROTTLE_HINTS = [
    /incapsula/i,
    /request unsuccessful/i,
    /access denied/i,
    /error reference/i,
];

export class LedClient {
    constructor({
        baseDelayMs = 1500,
        maxDelayMs = 60_000,
        maxAttempts = 5,
        verbose = false,
    } = {}) {
        this.baseDelayMs = baseDelayMs;
        this.maxDelayMs = maxDelayMs;
        this.maxAttempts = maxAttempts;
        this.verbose = verbose;

        this.cookies = [];
        this.seckey = null;
        this.currentDelay = baseDelayMs;
        this.throttleStreak = 0;
        this.stats = { requests: 0, throttled: 0, retried: 0, waitedMs: 0 };
    }

    #log(...a) {
        if (this.verbose) console.log("   [led]", ...a);
    }

    #absorb(res) {
        for (const c of res.headers["set-cookie"] || []) {
            const kv = c.split(";")[0];
            const name = kv.split("=")[0];
            /* replace rather than append: a new session id supersedes the old,
               otherwise the jar grows and sends contradictory cookies. */
            this.cookies = this.cookies.filter((x) => x.split("=")[0] !== name);
            this.cookies.push(kv);
        }
    }

    get cookieHeader() {
        return this.cookies.join("; ");
    }

    /** Open the session and read the one-time verification key from the form. */
    async open() {
        const res = await axios.get(LED_BASE, {
            responseType: "arraybuffer",
            timeout: 30_000,
            headers: this.#headers(),
        });
        this.#absorb(res);
        const $ = cheerio.load(decodeHtml(res.data).text);
        this.seckey = $('input[id="opass"]').val() ?? $('input[name="oseckey"]').attr("value") ?? null;

        /* Cache the form so we can rebuild the payload per request without
           re-fetching, and so every field stays in sync with the live markup. */
        const form = $("form#webForm").first();
        this.action = new URL(form.attr("action") || "default.asp", LED_BASE).toString();
        this.baseFields = {};
        form.find("input[name]").each((i, el) => {
            const type = ($(el).attr("type") || "text").toLowerCase();
            if (type === "button" || type === "submit") return;
            if (type === "checkbox" && $(el).attr("checked") === undefined) return;
            this.baseFields[$(el).attr("name")] = $(el).attr("value") ?? "";
        });
        form.find("select[name]").each((i, el) => {
            const sel = $(el).find("option[selected]").first().attr("value");
            this.baseFields[$(el).attr("name")] = sel ?? $(el).find("option").first().attr("value") ?? "";
        });

        this.#log(`session opened, seckey=${this.seckey}, fields=${Object.keys(this.baseFields).length}`);
        return this;
    }

    #headers(extra = {}) {
        return {
            "User-Agent": UA,
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "th-TH,th;q=0.9,en-US;q=0.8",
            ...extra,
        };
    }

    /** Build the POST body. UTF-8 percent-encoding; see NOTES.md §10. */
    #body(fields) {
        const payload = { ...this.baseFields, ...fields, search: "ok" };
        if (this.seckey) {
            payload.oseckey = this.seckey;
            payload.seckey = this.seckey;
        }
        return new URLSearchParams(payload).toString();
    }

    /**
     * POST the search form with retries.
     *
     * `expectRows` is how we detect throttling. A real result page contains
     * rows (or at least a totalpage field); a throttled one re-renders the form.
     * `expectRows: false` is for pages legitimately allowed to be empty.
     */
    async search(fields, { expectRows = true } = {}) {
        let lastErr = null;

        for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
            try {
                const body = this.#body(fields);
                const res = await axios.post(this.action, body, {
                    responseType: "arraybuffer",
                    timeout: 45_000,
                    headers: this.#headers({
                        "Content-Type": "application/x-www-form-urlencoded",
                        "Content-Length": Buffer.byteLength(body, "latin1"),
                        Referer: LED_BASE,
                        Cookie: this.cookieHeader,
                    }),
                });
                this.#absorb(res);
                this.stats.requests++;

                const html = decodeHtml(res.data).text;
                const $ = cheerio.load(html);
                const rowCount = $("tr").filter((i, e) => $(e).find('input[name="deedno"]').length).length;
                const totalPages = Number(
                    ($('input[name="totalpage"]').first().attr("value") || "0").replace(/\D/g, "") || 0,
                );
                const blocked = THROTTLE_HINTS.some((re) => re.test(html));

                /* Throttled = we got a 200 but the page is not a result page.
                   Being explicit here is what lets the caller report the
                   difference instead of silently writing an empty scrape. */
                const throttled = blocked || (expectRows && rowCount === 0 && totalPages === 0);

                if (!throttled) {
                    this.throttleStreak = 0;
                    this.currentDelay = this.baseDelayMs;
                    return { html, $, rowCount, totalPages, throttled: false, attempts: attempt };
                }

                this.stats.throttled++;
                this.throttleStreak++;
                lastErr = new Error(blocked ? "WAF challenge in response" : "empty result page (throttle?)");
                this.#log(`throttled (attempt ${attempt}), backing off`);
            } catch (err) {
                lastErr = err;
                this.stats.throttled++;
                this.throttleStreak++;
                this.#log(`error (attempt ${attempt}): ${err.message.slice(0, 60)}`);
            }

            if (attempt === this.maxAttempts) break;

            /* Exponential with FULL jitter. A fixed or partially-jittered delay
               synchronises concurrent callers onto the same edge node. */
            const ceiling = Math.min(this.currentDelay * 2 ** attempt, this.maxDelayMs);
            const wait = fullJitter(ceiling);
            this.stats.retried++;
            this.stats.waitedMs += wait;
            await sleep(wait);

            /* Adaptive: a run that keeps getting refused gets progressively
               slower rather than retrying at full speed. */
            if (this.throttleStreak >= 2) {
                this.currentDelay = Math.min(this.currentDelay * 2, this.maxDelayMs);
                this.#log(`pacing slowed to ${this.currentDelay}ms`);
            }
        }

        return {
            html: null,
            $: null,
            rowCount: 0,
            totalPages: 0,
            throttled: true,
            error: lastErr?.message ?? "unknown",
            attempts: this.maxAttempts,
        };
    }

    /** Politeness gap between requests, honouring adaptive pacing. */
    async pace() {
        const wait = this.currentDelay + fullJitter(500);
        this.stats.waitedMs += wait;
        await sleep(wait);
    }

    /** Per-lot detail page. Same retry policy, cookies included. */
    async detail(formFields) {
        const body = new URLSearchParams({ ...formFields }).toString();
        for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
            try {
                const res = await axios.post(new URL("asset_open.asp", LED_BASE).toString(), body, {
                    responseType: "arraybuffer",
                    timeout: 45_000,
                    headers: this.#headers({
                        "Content-Type": "application/x-www-form-urlencoded",
                        "Content-Length": Buffer.byteLength(body, "latin1"),
                        Referer: LED_BASE,
                        Cookie: this.cookieHeader,
                    }),
                });
                this.#absorb(res);
                this.stats.requests++;
                const html = decodeHtml(res.data).text;
                if (html.trim() === "") throw new Error("empty detail body");
                return cheerio.load(html);
            } catch (err) {
                this.stats.throttled++;
                if (attempt === this.maxAttempts) return null;
                const wait = fullJitter(Math.min(this.currentDelay * 2 ** attempt, this.maxDelayMs));
                this.stats.waitedMs += wait;
                await sleep(wait);
            }
        }
        return null;
    }

    summary() {
        return {
            ...this.stats,
            waitedSec: +(this.stats.waitedMs / 1000).toFixed(1),
            finalPacingMs: this.currentDelay,
            throttleStreak: this.throttleStreak,
        };
    }
}
