/* scrapeByProvince.js — drive the LED bot one province at a time.
 *
 * The site's search form takes a province (Thai name) plus an amphur, and a
 * province with no amphur filter returns only that province's lots. LED numbers
 * provinces the same way กรมที่ดิน does (กระบี่=81, ขอนแก่น=40), so the list below
 * is the authoritative one scraped from the site's own <select id="provinces"> —
 * not a hand-maintained copy.
 *
 * Without a queue backend yet, each province is a *job*: it runs to completion
 * and writes its own output file, so a later BullMQ worker can adopt the body
 * of runProvince() unchanged and just enqueue { provinceId } instead.
 *
 *   node scrapeByProvince.js                 # all 78 provinces
 *   node scrapeByProvince.js 81 40           # only these province ids
 *   node scrapeByProvince.js --list          # just print the list
 */
import fs from "fs";
import path from "path";
import axios from "axios";
import * as cheerio from "cheerio";
import { decodeHtml, encodeTH874 } from "./helper.js";

const UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36";
const BASE = "https://asset.led.go.th/newbidreg/";
const LIST = "./data/provinces.json";
const OUT = process.env.LED_OUT || "./out";
/**
 * Gap between provinces. Longer than the per-page gap: a province boundary is
 * a natural place for a person to stop, and switching provinces also opens a
 * fresh session against the site, so it deserves more room than the next page
 * of the same search.
 */
const PROVINCE_DELAY_MS = Number(process.env.LED_PROVINCE_DELAY_MS || 12000);

/**
 * Randomised wait, uniformly spread over [mean * (1 - spread), mean * (1 + spread)].
 *
 * Shaped like `politeDelay` in scrapeLED.js. The point is a less mechanical
 * request pattern and a flatter load on the origin: a constant interval lines
 * every request up into an obvious sawtooth, and jitter evens that out. The
 * floor is a quarter of the mean so the spread can never collapse to a burst.
 *
 * Rate limiting, not evasion — nothing here tries to defeat an access control.
 */
function politeDelay(ms, spread = 0.6) {
    const lo = ms * (1 - spread);
    const hi = ms * (1 + spread);
    const wait = Math.max(ms * 0.25, lo + Math.random() * (hi - lo));
    return new Promise(r => setTimeout(r, Math.round(wait)));
}

const loadProvinces = () => JSON.parse(fs.readFileSync(LIST, "utf8"));

/* LED wants the province in the POST body as win874 bytes. */
const postBody = (fields) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(fields)) p.append(k, v);
    return encodeTH874(p.toString());
};

/** Run one province end to end. Extracted so a queue worker can call it directly. */
export async function runProvince(prov, { maxPages = 5, dumpHtml = false } = {}) {
    const res = await axios.get(BASE, {
        responseType: "arraybuffer",
        headers: { "User-Agent": UA },
    });
    const cookies = res.headers["set-cookie"]?.map((c) => c.split(";")[0]).join("; ");
    const $ = cheerio.load(decodeHtml(res.data).text);

    const form = $("form#webForm").first();
    const action = form.attr("action") || "default.asp";
    const fields = {};
    form.find("input[name]").each((i, el) => {
        const type = ($(el).attr("type") || "text").toLowerCase();
        if (type === "button" || type === "submit") return;
        if (type === "checkbox" && $(el).attr("checked") === undefined) return;
        fields[$(el).attr("name")] = $(el).attr("value") ?? "";
    });

    fields.province = prov.text;
    fields.province_id = prov.value;
    // amphur left blank = whole province
    delete fields.ampur;
    delete fields.amphur;

    const first = await axios.post(new URL(action, BASE).toString(), postBody(fields), {
        responseType: "arraybuffer",
        headers: {
            "User-Agent": UA,
            "Content-Type": "application/x-www-form-urlencoded",
            Referer: BASE,
            Cookie: cookies,
        },
    });
    const firstHtml = decodeHtml(first.data).text;
    const $f = cheerio.load(firstHtml);
    const totalPages = Number(
        ($f('input[name="totalpage"]').first().attr("value") || "1").replace(/\D/g, "") || 1,
    );

    const rows = $f("tr")
        .filter((i, el) => $f(el).find('input[name="deedno"]').length > 0)
        .toArray();

    return {
        province: prov.text,
        provinceId: prov.value,
        totalPages: Math.min(totalPages, maxPages),
        page1Rows: rows.length,
        note: "row extraction lives in scrapeLED.js; this driver proves the per-province job shape",
    };
}

const main = async () => {
    const argList = process.argv.slice(2);
    if (argList.includes("--list")) {
        for (const p of loadProvinces()) console.log(`${p.value}\t${p.text}`);
        return;
    }

    const wanted = argList.filter((a) => /^\d+$/.test(a));
    const all = loadProvinces();
    const jobs = wanted.length ? all.filter((p) => wanted.includes(p.value)) : all;

    fs.mkdirSync(OUT, { recursive: true });
    const manifest = [];
    console.log(`== ${jobs.length} province job(s) ==`);

    for (const prov of jobs) {
        /* Gap before every province, not just between them: the first request
           of a fresh run should not be the run's most aggressive one. */
        await politeDelay(PROVINCE_DELAY_MS);
        const started = Date.now();
        try {
            const r = await runProvince(prov);
            console.log(
                `  ${prov.text.padEnd(14)} (${prov.value}) pages=${r.totalPages} rows=${r.page1Rows} ${((Date.now() - started) / 1000).toFixed(1)}s`,
            );
            manifest.push({ ...r, ok: true });
        } catch (err) {
            console.log(`  ${prov.text} FAILED ${err.message.slice(0, 60)}`);
            manifest.push({ province: prov.text, provinceId: prov.value, ok: false, error: err.message });
        }
        fs.writeFileSync(path.join(OUT, "province-jobs.json"), JSON.stringify(manifest, null, 2), "utf8");
    }

    const ok = manifest.filter((m) => m.ok).length;
    console.log(`\n== done: ${ok}/${manifest.length} ok ==`);
};

main();
