/**

  PHASE 1 — DISCOVERY MODE.

  Goal: find out what `deedno` actually contains when one auction case spans
  several deeds, before the schema is frozen. Run a small slice and dump raw
  HTML + parsed JSON.

      node scrapeLED.js                       # defaults below
      LED_PROVINCE=กรุงเทพมหานคร LED_MAX_PAGES=3 node scrapeLED.js

  Config comes from env vars so nothing is hardcoded. The production rewrite
  (queue, retries, per-item streaming) comes after the schema is settled.

*/

import axios from "axios";
import * as cheerio from "cheerio";
import { parseTHdate, encodeTH874, decodeHtml, timerStart, timerEnd } from "./helper.js";
import { priceRow } from "./pricing.js";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { pipeline } from "stream/promises";

const CONFIG = {
    province: process.env.LED_PROVINCE || "*",
    /**
     * Page cap. 0 means "every page the site reports" - the default, because a
     * fixed cap silently truncated provinces: Phuket's พ.376/2568 alone runs to
     * 17 lots across several pages, and a cap of 3 left us with 5 of them and
     * no way to tell truncation from a genuinely short list.
     * LED_MAX_PAGES still works as an escape hatch for a deliberate partial run.
     */
    maxPages: Number(process.env.LED_MAX_PAGES || 0),
    outDir: process.env.LED_OUT || "./out",
    dumpHtml: process.env.LED_DUMP_HTML !== "0",
    /** polite delay between page requests — the *mean*; actual waits are jittered */
    delayMs: Number(process.env.LED_DELAY_MS || 1500),
    /**
     * How much the per-request wait varies, as a fraction of delayMs.
     *
     * A fixed interval is the thing most worth changing here. Holding exactly
     * 1500ms between every request makes the client easy to single out and,
     * more to the point, keeps hammering in a way no person browsing would —
     * the site's own latency then guarantees bursts. Randomising spreads the
     * load out, and the occasional longer pause is what a person actually does
     * when they stop to read a row.
     *
     * This is rate limiting, not an attempt to defeat anything: the goal is to
     * ask for less, not to be harder to notice asking.
     */
    jitter: Number(process.env.LED_JITTER ?? 0.6),
};

/** Wait for a random interval around `ms`, never less than a quarter of it. */
export function politeDelay(ms, spread = CONFIG.jitter) {
    const lo = ms * (1 - spread);
    const hi = ms * (1 + spread);
    const wait = Math.max(ms * 0.25, lo + Math.random() * (hi - lo));
    return new Promise(res => setTimeout(res, Math.round(wait)));
}

const isDebug = process.env.LED_QUIET !== "1";

function getTotalPages(htmlBuffer) {
    const html = decodeHtml(htmlBuffer).text;
    const $ = cheerio.load(html);

    // search last -> fas fa-fast-forward -> input[name="page"]
    const lastPageInput = $("i.fa-fast-forward").closest("form").find('input[name="page"]');
    if (lastPageInput.length > 0) {
        const totalPages = parseInt(lastPageInput.val());
        return totalPages;
    }
    return 1; // return 1 if cannot find
}

// parser
const isSell = (text) => {
    if (text == null || text === "") return null;
    const map = {
        0: "ยังไม่ขาย",
        1: "ขายได้",
        3: "งดขายไม่มีผู้สู้ราคา",
        13: "งดขาย",
    };
    return map[text] ?? `ไม่รู้จัก(รหัส ${text})`;
};
const assetType = {
    "001": "ที่ดินว่างเปล่า",
    "0010": "หุ้น",
    "0011": "หน่วยลงทุน",
    "0012": "พันธบัตร",
    "0013": "ใบสำคัญ",
    "0014": "สลากออมสิน",
    "0015": "สลากออมทรัพย์",
    "002": "ห้องชุด",
    "003": "ที่ดินพร้อมสิ่งปลูกสร้าง",
    "004": "กรรมสิทธิ์ห้องชุด",
    "005": "สิทธิการเช่า",
    "006": "สิทธิการเช่าอาคารพาณิชย์",
    "007": "สิทธิการเช่าที่ดิน",
    "008": "ทรัพย์สินต่างๆ",
    "009": "สิ่งปลูกสร้าง",
    "010": "สิทธิการเช่าที่ดินฯ",
    "011": "สิทธิการเช่าสิ่งปลูกสร้าง",
    "012": "บัตรธนาคาร(เป็นเงินที่ชำระหนี้ได้ตามกฎหมาย)",
    "013": "สิทธิการเช่าอาคารราชพัสดุ",
    "014": "สิทธิการเช่าอาคาร",
    "016": "สิทธิการไถ่คืน",
    "017": "สิทธิการเช่าช่วงที่ดิน",
    "018": "อาวุธปืน",
    "019": "บัตรเงินฝาก",
    "020": "ธนบัตร",
};
/**
 * Normalise the `landtype` field (ชนิดโฉนด).
 *
 * LED sends at least four spellings for the same legal concept, and the
 * spacing is inconsistent between scrapes:
 *
 *   "โฉนดเลขที่"              -> โฉนด
 *   "หนือกรรมสิทธิ์"          -> โฉนด
 *   "ตามสำเนาโฉนดเลขที่"       -> ตามสำเนาโฉนด   (per-copy title — legally
 *                                                     distinct from โฉนด)
 *   "น.ส. 3 ก เลขที่" / "น.ส.3ก.เลขที่" -> น.ส.3ก.
 *
 * Normalisation is done by explicit patterns rather than "contains 3", which
 * would also swallow unrelated values. The raw string is always preserved
 * alongside, so an unrecognised spelling is visible rather than silently
 * passed through.
 */
const landtype = (text) => {
    if (text == null || String(text).trim() === "") return { code: null, raw: null };
    const raw = String(text).trim();
    const s = raw.replace(/\s+/g, ""); // collapse "น.ส. 3 ก" -> "น.ส.3ก."
    if (/^ตามสำเนา/.test(s)) return { code: "ตามสำเนาโฉนด", raw };
    if (/^น\.?ส\.?3ก/.test(s) || /^3ก/.test(s)) return { code: "น.ส.3ก.", raw };
    if (/^โฉนด/.test(s)) return { code: "โฉนด", raw };
    if (/^หนือกรรมสิทธิ์/.test(s)) return { code: "โฉนด", raw };
    return { code: raw, raw };
};

/**
 * Split the `deedno` field into individual deeds.
 *
 * Discovered against live markup + a กรมที่ดิน probe (phase 1). One auction lot can
 * list many deeds comma-separated, in three shapes:
 *
 *   "2162"        single deed
 *   "44082-5"     a run of deeds starting at 44082
 *   "171617 ฯลฯ"   single deed; "ฯลฯ" (et al.) means the SITE TRUNCATED the
 *                  list, so deeds exist that we never receive
 *
 * `N-M` counts deeds ambiguously — no single formula fits every sample.
 * Measured against กรมที่ดิน, which is ground truth for whether a deed exists:
 *
 *     44082-5  -> 44082..44086 exist, 44087 ABSENT   (5 deeds)
 *     122000-3 -> 122000..122003 exist, 122004 absent (4 deeds)
 *
 * So we deliberately OVER-expand to N..(N+M) inclusive and let กรมที่ดิน prune.
 * An extra candidate costs one cheap request that returns empty; a candidate we
 * failed to emit would silently drop a real parcel. Under-expansion is the
 * dangerous direction; over-expansion is self-correcting.
 *
 * `numbers` are candidates, not a promise. `needsPrune` marks runs whose last
 * candidate is expected to be absent.
 */
export function parseDeedNumbers(raw) {
    if (raw == null) return { raw: null, parts: [], numbers: [] };
    const s = String(raw).trim();
    if (!s) return { raw: s || null, parts: [], numbers: [] };

    const parts = [];
    for (const entry of s.split(",").map((e) => e.trim()).filter(Boolean)) {
        const range = /^(\d+)-(\d+)(.*)$/.exec(entry);
        if (range) {
            const start = Number(range[1]);
            const count = Number(range[2]);
            const numbers = [];
            for (let i = 0; i <= count; i++) numbers.push(String(start + i));
            parts.push({
                raw: entry, kind: "range", start, count, numbers,
                suffix: range[3].trim() || null,
                needsPrune: true,
            });
            continue;
        }
        const single = /^(\d+)\s*(.*)$/.exec(entry);
        if (single) {
            const suffix = single[2].trim() || null;
            const truncated = suffix === "ฯลฯ" || suffix === "ฯลฯ.";
            parts.push({
                raw: entry, kind: "single", numbers: [single[1]], suffix, truncated,
                /* กรมที่ดิน rejects the suffix — probe the bare number only */
                dolLookup: single[1],
                /* the site elided the rest of the list; we cannot know what is missing */
                needsReview: truncated,
            });
        } else {
            parts.push({ raw: entry, kind: "unparsed", numbers: [], suffix: null, needsReview: true });
        }
    }

    const numbers = [];
    for (const p of parts) {
        for (const n of p.numbers) if (!numbers.includes(n)) numbers.push(n);
    }
    return { raw: s, parts, numbers };
}

export async function scrapeLED() {
    /* Re-read per call, not per module load: backfillProvinces.js swaps
     * LED_PROVINCE between passes inside one process, and CONFIG was frozen at
     * import once — every pass after the first scraped the same province. */
    CONFIG.province = process.env.LED_PROVINCE || "*";
    /* `?? ""` not `||`: an empty LED_AMPUR is a deliberate province-wide search,
       but "" is falsy so `||` fell back to a district in another province and
       the server matched nothing. */
    CONFIG.ampur = process.env.LED_AMPUR ?? "";

    const pageLEDdata = [];

    const url = "https://asset.led.go.th/newbidreg/";
    const UA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36";

    fs.mkdirSync(CONFIG.outDir, { recursive: true });

    const getRes = await axios.get(url, {
        responseType: "arraybuffer",
        headers: { "User-Agent": UA },
    });
    const cookies = getRes.headers["set-cookie"]?.map((c) => c.split(";")[0]).join("; ");
    const html = decodeHtml(getRes.data).text;
    const $firstPage = cheerio.load(html);
    const seckey = $firstPage('input[id="opass"]').val();

    /* The search form posts to `default.asp` (relative), not to the directory we
       GET. It also carries hidden fields we were not sending — mode,
       search_bid_date, program_name, page_name — and omitting any of them makes
       the server re-render the form instead of returning rows. So: read every
       input off the form and let our config override only what we care about. */
    const form = $firstPage('form#webForm').first().length
        ? $firstPage('form#webForm').first()
        : $firstPage("form").filter((i, el) => $firstPage(el).find('input[name="oseckey"]').length).first();
    const action = form.attr("action") || "default.asp";
    const postUrl = new URL(action, url).toString();

    const basePayload = {};
    form.find("input[name]").each((i, el) => {
        const name = $firstPage(el).attr("name");
        const type = ($firstPage(el).attr("type") || "text").toLowerCase();
        // skip buttons and unchecked boxes; keep hidden + prefilled text
        if (type === "button" || type === "submit" || ($firstPage(el).attr("checked") === undefined && type === "checkbox")) return;
        basePayload[name] = $firstPage(el).attr("value") ?? "";
    });
    /* <select> elements (region_name, asset_type, rai_if, ...) are part of the
       submitted form too. Reading only input[name] silently dropped them. Use
       the pre-selected option, else the first one. */
    form.find("select[name]").each((i, el) => {
        const sel = $firstPage(el).find("option[selected]").first().attr("value");
        const first = $firstPage(el).find("option").first().attr("value");
        basePayload[$firstPage(el).attr("name")] = sel ?? first ?? "";
    });

    if (isDebug) {
        console.log(`[cfg] province=${CONFIG.province} ampur=${CONFIG.ampur} maxPages=${CONFIG.maxPages}`);
        console.log(`[cfg] seckey=${seckey ? "found" : "MISSING"}`);
        console.log(`[cfg] POST -> ${postUrl}`);
        console.log(`[cfg] base fields from form: ${Object.keys(basePayload).join(", ")}`);
    }

    const errors = [];
    /* Read from the site's own 	otalpage field on the first response; the
       loop then runs to that rather than to a number chosen here. */
    let total = 0;

    const cap = CONFIG.maxPages > 0 ? CONFIG.maxPages : Number.MAX_SAFE_INTEGER;
    for (let p = 1; p <= cap; p++) {
        if (isDebug) {
            timerStart();
            console.log(`--- Fetching Page ${p}/${CONFIG.maxPages} ---`);
        }

        /* Build the body from the form's own fields, then override the search
           criteria. Thai criteria go in as UTF-8 (URLSearchParams' native
           percent-encoding) — the site expects UTF-8, NOT win874.
           province="*" means "do not filter by region" — used to prove the
           endpoint returns rows at all before narrowing down. */
        const noRegion = CONFIG.province === "*";
        const fields = {
            ...basePayload,
            province: noRegion ? "" : CONFIG.province,
            ampur: noRegion ? "" : CONFIG.ampur,
            tumbol: "",
            asset_type: "",
            person1: "",
            bid_date: "",
            price_begin: "",
            price_end: "",
            rai_if: "1", rai: "",
            quaterrai_if: "1", quaterrai: "",
            wa_if: "1", wa: "",
            search: "ok",
            page: String(p),
        };
        /* The one-time verification key must ride on EVERY page request. Sending it
           only on page 1 made the site reject pages 2+ (zero rows, no error),
           so a 112-page province silently returned 30 rows. It is a fixed value
           for the session, not a per-page nonce. */
        fields.oseckey = seckey;
        fields.seckey = seckey;
        /* Thai criteria go in the body as UTF-8 percent-encoding — the site sends and
           expects UTF-8, NOT win874. Passing them through encodeTH874() produced
           bytes the server never matches: it echoed the criteria back as literal
           "%E0%B8%82..." and returned ไม่พบข้อมูล with zero rows. URLSearchParams
           already emits UTF-8 percent-encoding, so its output is the body as-is —
           any second encode pass re-escapes every '%' into '%25'. */
        const currentPayload = new URLSearchParams(fields).toString();

        try {
            // response
            const response = await axios.post(postUrl, currentPayload, {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    Cookie: cookies,
                    "User-Agent": UA,
                    Referer: url,
                },
                responseType: "arraybuffer",
            });

            const resultHtml = decodeHtml(response.data).text;
            const $ = cheerio.load(resultHtml);

            // parse page count once — it does not change between pages
            if (p === 1) {
                total = getTotalPages(resultHtml);
                if (isDebug) console.log(`[cfg] site reports ${total} total pages`);
                if (CONFIG.dumpHtml) {
                    fs.writeFileSync(path.join(CONFIG.outDir, "page-1.html"), resultHtml, "utf8");
                    if (isDebug) console.log(`[dump] wrote ${CONFIG.outDir}/page-1.html`);
                }
            }

            /* Result rows. The old selector was `#box-table-a tbody tr`; the table
               now has no id (it is `<table class="table table-hover">`). Matching on
               the row-level `deedno` input is stable regardless of table styling.
               Dead rows were once excluded via bgcolor="#FEE6E6" — that marker is
               gone from the current markup, but keep the guard in case it returns. */
            const tableRows = $("tr")
                .filter((i, el) => $(el).find('input[name="deedno"]').length > 0)
                .filter((i, el) => $(el).attr("bgcolor") !== "#FEE6E6");
            if (p === 1 && tableRows.length === 0) {
                errors.push({ page: p, kind: "no_rows", hint: "no tr containing input[name=deedno]" });
                if (isDebug) console.warn(`[warn] 0 result rows matched on page 1`);
            }
            /* Sequential for...of, NOT cheerio's .each(): the body below is async (image
               downloads) and .each() does not await its callbacks. That let row
               pushes and image writes race past the page loop, so only page 1's
               rows ever landed before return — pages 2+ silently vanished. */
            let rowIndex = 0;
            for (const element of tableRows.toArray()) {
                const index = rowIndex++;
                const tds = $(element).find("td");

                // helper - get input value by given name
                const compact = (name) => {
                    return tds.find(`input[name="${name}"]`).val()?.trim() ?? null;
                };

                if (tds.length > 0) {
                    const deedRaw = compact("deedno");
                    const item = {
                        published_date: parseTHdate(compact("ischeck_date")), // วันที่ประกาศขึ้นเว็บ
                        case_no: {
                            number: compact("law_suit_no"), // หมายเลขคดี (จริง ๆ เป็นชื่อคดีภาษาไทย)
                            year: compact("law_suit_year"), // ปีคดี (พ.ศ.)
                        },
                        court: compact("law_court_name"), // ศาล
                        plaintiff: compact("person1"), // โจกย์
                        defendant: compact("person2"), // จำเลย
                        owner: compact("ownername"), // ผู้ถือสิทธิครอบครอง
                        legal_execution_department: compact("province_name"), // สำนักงานบังคับคดี/กอง
                        order: {
                            number: compact("fbidnum"), // ลำดับการขาย เลขหลัก
                            sub_number: compact("fsubbidnum"), // ลำดับการขาย เลขรอง
                            combined: compact("str_bid_num"), // "N - M" ตามที่เว็บแสดง
                        },
                        type: compact("assettypedesc"), // ประเภททรัพย์
                        size: {
                            rai: compact("rai"), // ไร่
                            ngan: compact("quaterrai"), // งาน
                            wa: compact("wa"), // ตร.วา
                        },
                        address: {
                            /* ชนิดโฉนด — legal title type. Distinct from the
                               asset `type` above. `raw` is kept because LED's
                               spelling varies between scrapes. */
                            land_title: landtype(compact("landtype")).code,
                            land_title_raw: landtype(compact("landtype")).raw,
                            number: deedRaw, // โฉนด เลขที่ (ดิบ อาจมีหลายเลขคั่นด้วย ",")
                            // แตกเป็นราย โฉนด — หนึ่งล็อตอาจมีหลายแปลง
                            deeds: parseDeedNumbers(deedRaw),
                            tumbol: compact("deedtumbol"), // โฉนด ตำบล
                            amphur: compact("deedampur"), // โฉนด อำเภอ
                            city: compact("deedcity"), // โฉนด จังหวัด
                            province_id: compact("province_id"),
                            landdesc: compact("landdesc"), // รายละเอียดแปลง (มีไม่ครบทุกแถว)
                            addr_no: compact("addrno"),
                        },
                        bid: {
                            /* The page carries issale1..issale8 but biddate1..6 only
                               (7 and 8 are empty in every row seen), so rounds are
                               built from the status slots and dates filled in when
                               present. */
                            rounds: Array.from({ length: 8 }, (_, i) => ({
                                idx: i + 1,
                                date: parseTHdate(compact(`biddate${i + 1}`)),
                                status: isSell(compact(`issale${i + 1}`)),
                                statusCode: compact(`issale${i + 1}`),
                            })),
                            sell_type: compact("saletypename"), // จะทำการขายโดย ปลอดการจำนอง ...
                            debt_name: compact("debtname"), // ติดจำนอง
                            debt_price: compact("debtprice"), // ยอดหนี้จำนอง
                            sell_location: compact("sale_location1"),
                            sell_time: compact("sale_time1"),
                            price: {
                                bid_security: compact("ReserveFund"), // ต้องวางหลักประกัน
                                expert_appraisal_price: compact("assetprice2"), // ผู้เชี่ยวชาญการประเมินราคา TEST:
                                officer_appraisal_price: compact("assetprice3"), // เจ้าพนักงานบังคับคดี
                                led_appraisal_price: compact("assetprice4"), // เจ้าพนักงานประเมินราคาทรัพย์กรมบังคับคดี TEST:
                                committee_appraisal_price: compact("assetprice5"), // คณะกรรมการกำหนดราคาทรัพย์ TEST:
                            },
                        },
                        remark: compact("remark"), // หมายเหตุ

                        /* รูปถ่าย/แผนที่ — three files per lot, all three present on
                           every row sampled (30/30). The Z:\ paths are internal
                           SMB shares; LED serves them from /PPKPicture/ with the
                           separators flipped. Verified: 112 KB / 140 KB / 30 KB
                           real JPEGs.

                           OWNERSHIP: these belong to this LED ROW. A row usually
                           covers one deed, so that deed owns them outright. When
                           a row expands to several deeds they all share the same
                           set — LED gives no per-deed image. Deeds that arrive
                           without their own row images fall back to the lot's set. */
                        images: [
                            { kind: "photo", raw: compact("landpicture") }, // รูปถ่ายทรัพย์
                            { kind: "survey", raw: compact("mapjot") }, // แผนที่ถูกต้อง
                            { kind: "map", raw: compact("map") }, // ผังที่ตั้ง
                        ].map((im) => ({
                            kind: im.kind,
                            raw: im.raw,
                            url: im.raw
                                ? im.raw.replaceAll("\\", "/").replace(
                                      "Z:/",
                                      "https://asset.led.go.th/PPKPicture/",
                                  )
                                : null,
                            file: null,
                        })),
                    };
                    pageLEDdata.push(priceRow(item));

                    /* Download the lot's images. LED serves them from
                       /PPKPicture/ with the SMB separators flipped; the
                       resulting <hash>.jpg is stable per source path, so a
                       re-run overwrites rather than duplicating. Written under
                       public/ so the dev server can serve them with no backend
                       — later this becomes a DB blob column and the fetch moves
                       behind the API, and only saveRemote() changes. */
                    fs.mkdirSync("public/img/land", { recursive: true });
                    await Promise.all(
                        item.images.map(async (im) => {
                            if (!im.url) return;
                            const hash = crypto
                                .createHash("md5")
                                .update(im.url)
                                .digest("hex")
                                .slice(0, 10);
                            const filePath = `public/img/land/${hash}.jpg`;
                            im.file = `/img/land/${hash}.jpg`;
                            try {
                                const res = await axios.get(im.url, {
                                    responseType: "stream",
                                    timeout: 30000,
                                    headers: {
                                        Referer: "https://asset.led.go.th",
                                        "User-Agent": UA,
                                    },
                                });
                                if (String(res.headers["content-type"] || "").startsWith("image/")) {
                                    await pipeline(res.data, fs.createWriteStream(filePath));
                                    if (isDebug) console.log(`image saved: ${filePath}`);
                                } else {
                                    im.file = null;
                                    if (isDebug) console.log(`not an image: ${im.url}`);
                                }
                            } catch (err) {
                                im.file = null;
                                if (isDebug) console.log(`image failed: ${im.url} ${err.message}`);
                            }
                        }),
                    );
                }
            }

            if (isDebug) {
                timerEnd();
                console.log(`Page ${p}: ${pageLEDdata.length} active items so far.`);
            }

            // stop at the configured cap or the site's own page count
            /* Either the site's own page count or the optional caller cap. */
      if (p >= total || p >= cap) break;

            // polite, jittered delay before the next page
            await politeDelay(CONFIG.delayMs);
        } catch (error) {
            // one bad page must not kill the whole run — record it and move on
            errors.push({ page: p, kind: "fetch", message: error.message });
            console.error(`Error on page ${p}:`, error.message);
            if (p === 1) break; // nothing works without page 1
            /* A failed page gets a longer, wider pause. Backing off harder after
               an error is standard client behaviour and gives the site room
               before we try again. */
            await politeDelay(CONFIG.delayMs * 3);
        }
    }

    return { rows: pageLEDdata, errors, totalPages: total, config: CONFIG };
}
