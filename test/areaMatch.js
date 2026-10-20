import { normaliseName } from "./tdDict.js";

/* areaMatch.js - match LED districts against TD districts and report the gaps.
 *
 * LED and TD renumber districts independently, and LED sometimes misses one
 * entirely, so a code join cannot work. Names can, but not by equality:
 *
 *   LED prefixes island districts with อำเภอ   (เกาะกูด -> อำเภอเกาะกูด)
 *   TD carries letter-suffixed codes        (ท่าใหม่ -> ท1)
 *   a district can be RENAMED between systems (พลอยแหวน -> ท่าใหม่)
 *
 * So: normalise names, score candidates, and print everything that does not
 * pair confidently for a human to decide. Nothing is auto-applied - a wrong
 * merge here silently reassigns every parcel in that district.
 *
 * TD ground truth below is copied verbatim from the Treasury page the user
 * captured. TD publishes no subdistrict level, so this covers two of three
 * levels; the subdistrict dictionary still comes from LED alone.
 */

/** TD districts, copied from the captured AMPH_CODE lists. */
const TD_DISTRICTS = {
    22: {
        name: "จันทบุรี",
        districts: {
            "01": "เมืองจันทบุรี", "02": "ขลุง", "03": "เขาคิชฌกูฏ", "04": "โป่งน้ำร้อน",
            "05": "มะขาม", "06": "แหลมสิงห์", "07": "สอยดาว", "08": "แก่งหางแมว",
            "09": "นายายอาม", "10": "ท่าใหม่".replace("10", "ท1"), "พ1": "พลอยแหวน",
        },
    },
    23: {
        name: "ตราด",
        districts: {
            "01": "เมืองตราด", "02": "คลองใหญ่", "03": "เขาสมิง", "04": "บ่อไร่",
            "05": "แหลมงอบ", "06": "เกาะกูด", "07": "เกาะช้าง",
        },
    },
};

const LED = "https://asset.led.go.th/newbidreg";
const UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36";


/** Dice coefficient over bigrams - cheap and good enough to rank candidates. */
function similarity(a, b) {
    const A = normaliseName(a);
    const B = normaliseName(b);
    if (!A || !B) return 0;
    if (A === B) return 1;
    if (A.length < 2 || B.length < 2) return A === B ? 1 : 0;
    const grams = (s) => {
        const g = new Map();
        for (let i = 0; i < s.length - 1; i++) {
            const k = s.slice(i, i + 2);
            g.set(k, (g.get(k) ?? 0) + 1);
        }
        return g;
    };
    const ga = grams(A);
    const gb = grams(B);
    let shared = 0;
    for (const [k, n] of ga) shared += Math.min(n, gb.get(k) ?? 0);
    return (2 * shared) / ((A.length - 1) + (B.length - 1));
}

function parseOptions(html) {
    const out = [];
    const re = /<option[^>]*value=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/option>/gi;
    let m;
    while ((m = re.exec(html))) {
        const value = m[2].replace(/^﻿/, "").trim();
        const label = m[3].replace(/^﻿/, "").replace(/<[^>]*>/g, "").trim();
        if (value) out.push({ value, label });
    }
    return out;
}

async function ledDistricts(provCode) {
    const r = await fetch(`${LED}/get_amphur.asp?provinceId=${provCode}`, {
        headers: { Accept: "*/*", "User-Agent": UA, Referer: `${LED}/default.asp` },
    });
    return parseOptions(await r.text()).filter(
        (d) => d.value !== `${provCode}00` && d.label && d.value.slice(2),
    );
}

const manual = [];
let unmatched = 0;
let matched = 0;

for (const [pc, td] of Object.entries(TD_DISTRICTS)) {
    const led = await ledDistricts(pc);
    console.log(`\n=== ${td.name} (${pc}) — TD ${Object.keys(td.districts).length}, LED ${led.length} ===\n`);

    const taken = new Set();
    const pairs = [];
    for (const [tdCode, tdName] of Object.entries(td.districts)) {
        let best = null;
        for (const l of led) {
            if (taken.has(l.value)) continue;
            const score = similarity(l.label, tdName);
            if (!best || score > best.score) best = { led: l, score };
        }
        if (best && best.score >= 0.6) {
            taken.add(best.led.value);
            pairs.push({ tdCode, tdName, led: best.led, score: best.score });
        } else {
            pairs.push({ tdCode, tdName, led: null, score: best?.score ?? 0 });
        }
    }

    pairs.sort((a, b) => a.tdCode.localeCompare(b.tdCode));
    for (const p of pairs) {
        if (p.led) {
            matched++;
            const flag = p.score === 1 ? "exact" : `${Math.round(p.score * 100)}%`;
            console.log(`  ok      TD ${p.tdCode.padEnd(3)} ${p.tdName.padEnd(16)} <-> LED ${p.led.value} ${p.led.label}  (${flag})`);
        } else {
            unmatched++;
            console.log(`  NO MATCH  TD ${p.tdCode.padEnd(3)} ${p.tdName}`);
            manual.push({ province: td.name, provCode: pc, tdCode: p.tdCode, tdName: p.tdName });
        }
    }
    for (const l of led) {
        if (taken.has(l.value)) continue;
        unmatched++;
        console.log(`  NO MATCH  (LED-only) ${l.value} ${l.label}`);
        manual.push({ province: td.name, provCode: pc, tdCode: null, tdName: null, ledCode: l.value, ledName: l.label });
    }
}

console.log(`\n\n=== summary: ${matched} matched, ${unmatched} needing a human ===`);
console.log("\nPaste these into the override table when you have decided them:\n");
console.log(JSON.stringify(manual, null, 2));