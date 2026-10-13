/* imageStore.js — fetch LED lot images once, then never again.
 *
 * Why this exists: LED serves ONE photo set per listing (photo / survey / map).
 * The listing keeps the same paths for its whole life, and when a lot is
 * re-listed it often reuses the same set. So the correct policy is:
 *
 *   fetch an image the FIRST time we see its URL, then reuse the cached file.
 *
 * Volume therefore scales with NEW lots, not with scrape volume. A nightly
 * re-scrape of a province we already have costs zero image requests — which is
 * what keeps us under the WAF (see NOTES.md §13, where 6,453 downloads got us
 * rate-limited to zero rows).
 *
 * Dedup key is the URL itself, normalised, because that is what actually
 * identifies the bytes. The same picture reached by two different paths still
 * downloads twice, which is the safe direction to err in.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import axios from "axios";

const UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36";
const LED_PICTURE_BASE = "https://asset.led.go.th/PPKPicture/";

/** LED hands out internal SMB paths ("Z:\2569\..."); convert to a fetchable URL. */
export function toUrl(raw) {
    if (!raw) return null;
    return String(raw).replaceAll("\\", "/").replace("Z:/", LED_PICTURE_BASE);
}

/** Stable id for an image URL — same URL always yields the same name. */
export function imageKey(url) {
    return crypto.createHash("sha256").update(url).digest("hex").slice(0, 24);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * LocalImageStore: files on disk plus an index, so a re-run in a fresh process
 * still knows what it already has. In production the DB holds this table; this
 * mirrors it so the scraper stays usable without one.
 */
export class LocalImageStore {
    constructor(dir, { delayMs = 1200, concurrency = 1 } = {}) {
        this.dir = dir;
        this.indexPath = path.join(dir, "index.json");
        this.delayMs = delayMs;
        this.concurrency = concurrency;
        this.index = this.#load();
        fs.mkdirSync(dir, { recursive: true });
    }

    #load() {
        try {
            return JSON.parse(fs.readFileSync(this.indexPath, "utf8"));
        } catch {
            return {};
        }
    }

    #save() {
        fs.writeFileSync(this.indexPath, JSON.stringify(this.index, null, 2), "utf8");
    }

    has(url) {
        const k = imageKey(url);
        return Boolean(this.index[k]?.file && fs.existsSync(this.index[k].file));
    }

    /** URLs from a scraped row, normalised and de-duplicated. */
    static urlsOf(lot) {
        return [...new Set((lot.images ?? []).map((i) => toUrl(i.raw)).filter(Boolean))];
    }

    /**
     * Fetch anything not already cached.
     *   force: true re-downloads everything (repairs a corrupted cache).
     * Returns { downloaded, skipped, failed }.
     */
    async fetchAll(lots, { force = false } = {}) {
        const want = [...new Set(lots.flatMap((l) => LocalImageStore.urlsOf(l)))];
        const todo = force ? want : want.filter((u) => !this.has(u));

        const stats = {
            wanted: want.length,
            downloaded: 0,
            skipped: want.length - todo.length,
            failed: 0,
            bytes: 0,
        };
        if (!todo.length) return stats;

        console.log(`  images: ${stats.skipped} cached, ${todo.length} to fetch`);

        /* Sequential by default. Concurrency is what walked us into the WAF
           block, so raising it is a deliberate, measured decision — never a
           default. */
        for (const url of todo) {
            try {
                await sleep(this.delayMs);
                const res = await axios.get(url, {
                    responseType: "arraybuffer",
                    timeout: 30000,
                    headers: { Referer: "https://asset.led.go.th", "User-Agent": UA },
                    maxRedirects: 3,
                });
                const ct = String(res.headers["content-type"] || "");
                const buf = Buffer.from(res.data);

                /* LED answers 200 with HTML for unknown paths, so trusting the
                   status code alone silently writes junk files. */
                if (!ct.startsWith("image/")) throw new Error(`not an image (${ct || "no content-type"})`);
                if (buf.length < 1024) throw new Error(`suspiciously small (${buf.length}B)`);

                const key = imageKey(url);
                const file = path.join(this.dir, `${key}.jpg`);
                fs.writeFileSync(file, buf);

                this.index[key] = { url, file, bytes: buf.length, fetched_at: new Date().toISOString() };
                stats.downloaded++;
                stats.bytes += buf.length;
            } catch (err) {
                stats.failed++;
                console.log(`  ! ${url.slice(-46)} ${err.message.slice(0, 50)}`);
            }
            if (stats.downloaded % 25 === 0) this.#save();
        }

        this.#save();
        return stats;
    }

    get cachedCount() {
        return Object.keys(this.index).length;
    }

    /** Look up a cached URL for DB storage (relative path, or null). */
    localPathFor(url) {
        const k = imageKey(url);
        const hit = this.index[k];
        return hit?.file ? path.basename(hit.file) : null;
    }
}

/**
 * Budget-aware helper: given the number of NEW lots, say whether fetching now
 * is safe. The nightly re-scrape path should always be near zero because
 * `urlsOf` de-duplicates, so lots already cached contribute nothing.
 */
export function planImageBudget(lots, { dailyCap = 300 } = {}) {
    const newUrls = [...new Set(lots.flatMap((l) => LocalImageStore.urlsOf(l)))];
    const estimated = newUrls.length; // already one entry per distinct image
    const minDelayMs = 1200;
    return {
        estimated,
        cap: dailyCap,
        over_budget: estimated > dailyCap,
        min_delay_ms: minDelayMs,
        estimated_minutes: +((estimated * minDelayMs) / 60000).toFixed(1),
    };
}
