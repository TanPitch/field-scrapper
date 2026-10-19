/* dolLookup.js — the กรมที่ดิน transport, as a single injectable function.
 *
 * This is the piece that was missing: resolveCoords.js had the queue, the quota
 * ledger, the verification rules and the provenance, but nothing to call. This
 * supplies it, and deliberately nothing more.
 *
 * How LandsMaps actually works (established in scrapeLand.js, kept here so the
 * transport is self-contained):
 *   1. open the site with Puppeteer
 *   2. read `userinfo` out of sessionStorage for an `access_token`
 *   3. GET apiService/LandsMaps/GetParcelByParcelNo/{prov}/{amphur}/{deed}
 *      with `Authorization: Bearer <token>`
 *
 * Conduct:
 *   * ONE browser, ONE token, ONE session for the whole run.
 *   * Sequential only, with a delay between calls. No concurrency.
 *   * Never asks for more than the ledger allows.
 *   * The service signals the daily limit with HTTP 200 and a business message,
 *     "เกินจำกัด 20 /วัน". That is detected and reported so the caller can stop
 *     cleanly instead of retrying into a wall.
 */
import puppeteer from "puppeteer";
import { existsSync } from "node:fs";

/**
 * A browser to drive.
 *
 * Puppeteer normally launches the Chrome build it downloaded into its own cache.
 * That cache is empty on this machine, and the alternative - `npx puppeteer
 * browsers install chrome` - is a 150MB download for a bot that only reads a
 * public map. Chrome is already installed, so use it.
 *
 * PUPPETEER_EXECUTABLE_PATH overrides everything, which is how a Docker image
 * says which browser it has. The list below covers both platforms so the same
 * code runs on this Windows box and on a Linux container:
 *
 *   Linux   /usr/bin/google-chrome, /usr/bin/chromium, /usr/bin/chromium-browser
 *   Windows the two Program Files paths, and the per-user one
 *
 * If none of them exists the call falls back to whatever Puppeteer has cached,
 * which is the right answer inside a Docker image built with
 * `npx puppeteer browsers install chrome`. A browser that is not there is a
 * clear error at launch, not a silent wrong-browser run.
 */
const systemChrome = () => {
  const paths = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  ].filter(Boolean);
  return paths.find((p) => existsSync(p)) ?? null;
};

const DOL_API = "https://landsmaps.dol.go.th/apiService/LandsMaps/GetParcelByParcelNo/";
const LANDMAPS = "https://landsmaps.dol.go.th/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Thai land area: 1 ไร่ = 4 งาน = 400 ตร.วา, 1 งาน = 100 ตร.วา. */
export function toSqWa(rai, ngan, wa) {
    const r = Number(rai), n = Number(ngan), w = Number(wa);
    if (!Number.isFinite(r) && !Number.isFinite(n) && !Number.isFinite(w)) return null;
    return (Number.isFinite(r) ? r : 0) * 400
        + (Number.isFinite(n) ? n : 0) * 100
        + (Number.isFinite(w) ? w : 0);
}

/** Pull a land parcel once, reusing the caller's browser session. */
export async function createDolLookup({
    delayMs = 1200,
    timeoutMs = 60_000,
    log = () => {},
} = {}) {
    const browser = await puppeteer.launch({
        headless: true,
        ...(systemChrome() ? { executablePath: systemChrome() } : {}),
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    const page = await browser.newPage();
    await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36");
    await page.setExtraHTTPHeaders({ "Accept-Language": "th-TH,th;q=0.9,en;q=0.8" });

    // example.com first, exactly as scrapeLand.js does — the site appears to
    // expect a prior navigation before it populates sessionStorage
    await page.goto("https://www.example.com", { waitUntil: "networkidle2", timeout: timeoutMs });
    await page.goto(LANDMAPS, { waitUntil: "networkidle2", timeout: timeoutMs });

    /* The SPA keeps navigating after load, which detaches the frame handle an
       evaluate captured ("Attempted to use detached Frame"). Re-acquiring the
       live main frame and retrying settles it — verified necessary, not
       theoretical. */
    let token = null;
    let lastErr = null;
    for (let attempt = 1; attempt <= 8 && !token; attempt++) {
        try {
            token = await page.mainFrame().evaluate(() => {
                try {
                    return JSON.parse(sessionStorage.getItem("userinfo"))?.access_token ?? null;
                } catch { return null; }
            });
        } catch (e) {
            lastErr = e;
            token = null;
        }
        if (!token && attempt < 8) await sleep(2000);
    }

    if (!token) {
        await browser.close().catch(() => {});
        throw new Error(
            `LandsMaps: no access_token in sessionStorage after 8 attempts` +
            (lastErr ? ` (last frame error: ${lastErr.message})` : ""),
        );
    }
    log("token acquired");

    let calls = 0;

    /**
     * @param {{province_code:number, district_dol_code:number, deed_number:string}} parcel
     * @returns {Promise<object>} normalised result
     */
    const lookup = async (parcel) => {
        if (delayMs && calls > 0) await sleep(delayMs);
        const url = `${DOL_API}${parcel.province_code}/${parcel.district_dol_code}/${parcel.deed_number}`;
        calls++;

        const data = await page.evaluate(async (apiUrl, tk) => {
            const res = await fetch(apiUrl, {
                method: "GET",
                credentials: "include",
                headers: {
                    Authorization: `Bearer ${tk}`,
                    Accept: "application/json",
                    "Content-Type": "application/json",
                    "X-Requested-With": "XMLHttpRequest",
                },
            });
            const text = await res.text();
            try { return JSON.parse(text); } catch { return { __raw: text }; }
        }, url, token);

        // The quota refusal is HTTP 200 with a business message. Recognising it
        // is what lets the caller stop instead of burning the rest of the queue.
        const msg = data?.message ?? data?.error ?? "";
        if (/เกินจำกัด|จำกัด\s*\d+\s*\/\s*วัน|exceed/i.test(String(msg))) {
            return { status: "quota_exhausted", message: String(msg) };
        }

        const r = Array.isArray(data?.result) ? data.result[0] : null;
        if (!r || (r.parcellat == null && r.parcellon == null)) {
            return { status: "not_found", found: false, message: msg || "empty result" };
        }

        return {
            found: true,
            status: "ok",
            lat: r.parcellat ?? null,
            lon: r.parcellon ?? null,
            rai: r.rai ?? null,
            ngan: r.ngan ?? null,
            wa: r.wa ?? null,
            areaSqWa: toSqWa(r.rai, r.ngan, r.wa),
            landPrice: r.landprice ?? null,
            landType: r.parcel_type ?? r.land_type ?? null,
            office: r.landoffice ?? null,
            utm: {
                utm1: r.utm1 ?? null, utm2: r.utm2 ?? null,
                utm3: r.utm3 ?? null, utm4: r.utm4 ?? null,
                scale: r.utmscale ?? null,
            },
        };
    };

    lookup.calls = () => calls;
    lookup.close = () => browser.close();
    return lookup;
}
