/* pricing.js — start-price cascade + per-round discount ladder for LED lots.
 *
 * LED publishes ONE price per lot, not a price per round. The per-round price is
 * derived: each งดขายไม่มีผู้สู้ราคา (no-bid) round drops the next round by
 * 10%, capped at -30%. Codes are confirmed against the LED site (see NOTES.md).
 *
 * Nothing here predicts future rounds — every price is computed only from rounds
 * that have already happened.
 */

/** Confirmed status codes. Verified against asset_open.asp detail pages. */
export const SELL_STATUS = {
    0: "ยังไม่มีการเปิดประมูล", // no auction held at this slot (LED shows "- คลิกเข้าร่วม")
    1: "ขายได้", // sold
    3: "งดขายไม่มีผู้สู้ราคา", // no bidder — this is what drives the discount
    4: "งดขายส่งประกาศมิชอบ", // cancelled via an irregular announcement
    6: "ถอนการยึด", // seizure revoked
    7: "โจทก์แถลงงดขาย", // plaintiff announced cancellation
    10: "งดขาย",
    12: "งดขาย (ป.วิ.แพ่ง มาตรา 309)", // cancelled by court order, Civil Procedure Act s.309
    13: "งดขาย",
    23: "งดขาย",
    26: "งดขายในนัดที่เหลือ", // cancelled for all remaining rounds
};

/**
 * Codes after which the lot leaves LED and no further round will ever happen.
 * Only these three mean "this lot is done".
 */
export const TERMINAL_CODES = new Set([1, 6, 26]);

export const CLOSED_REASON = {
    1: "sold",
    6: "seizure_revoked",
    26: "cancelled_remaining_rounds",
};

/** Discount depth per consecutive no-bid round, capped at 30%. */
export const DISCOUNT_STEP_PCT = 10;
export const MAX_DISCOUNT_PCT = 30;

/** Parse "1,234.00" / "1,000" / "" into a number, or null. */
export function parseAmount(raw) {
    if (raw == null) return null;
    const s = String(raw).replace(/[,\s]/g, "");
    if (s === "" || s === "0" || !/^\d+(\.\d+)?$/.test(s)) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
}

/**
 * Starting price = first non-zero in LED's cascade order. Verified against the
 * detail page, which prints the four prices in exactly this sequence:
 *   คณะกรรมการกำหนดราคาทรัพย์ -> ราคาประเมินราคาทรัพย์กรมบังคับคดี
 *   -> ราคาประเมินของเจ้าพนักงานบังคับคดี -> ราคาประเมินของผู้เชี่ยวชาญฯ
 *
 * `assetprice1` is not part of the cascade (0 on every row sampled).
 */
const CASCADE = [
    ["committee", "committee_appraisal_price", "assetprice5"], // คณะกรรมการกำหนดราคาทรัพย์
    ["led", "led_appraisal_price", "assetprice4"], // ราคาประเมินราคาทรัพย์กรมบังคับคดี
    ["officer", "officer_appraisal_price", "assetprice3"], // เจ้าพนักงานบังคับคดี
    ["expert", "expert_appraisal_price", "assetprice2"], // ผู้เชี่ยวชาญการประเมินราคา
];

export function resolveStartPrice(price = {}) {
    const checked = [];
    for (const [key, field] of CASCADE) {
        const value = parseAmount(price[field]);
        checked.push({ key, field, value });
        if (value !== null && value > 0) return { start_price: value, start_price_source: key, checked };
    }
    return { start_price: null, start_price_source: null, checked };
}

/**
 * Walk a lot's rounds and attach price + ladder state to each.
 *
 * Rule: only code 3 (งดขายไม่มีผู้สู้ราคา) deepens the discount. งดขาย-family
 * codes neither deepen nor reset it — confirmed example:
 *   งดขาย, งดขาย, งดขายไม่มีผู้สู้ราคา, งดขาย  ->  round 5 is -10%
 *
 * A round's own price reflects the no-bid count from rounds BEFORE it, since a
 * no-bid round is itself held at the undiscounted price.
 */
export function priceRounds(rounds = [], startPrice = null) {
    const out = [];
    let noBidCount = 0;

    for (const r of rounds) {
        const code = r.statusCode == null ? null : Number(r.statusCode);
        const isNoBid = code === 3;
        const isHeld = code !== null && code !== 0;

        // Discount in force for THIS round, derived from rounds before it only.
        // A no-bid round is itself held at the undiscounted price, which is why
        // the increment happens after this round's own price is computed.
        const discountPct = Math.min(noBidCount * DISCOUNT_STEP_PCT, MAX_DISCOUNT_PCT);

        // An unheld slot (code 0) shows what the round WOULD fetch if it happened,
        // so it carries the same discounted value. Only the very first slot has
        // no prior round, hence the isHeld/noBidCount guard.
        const price =
            startPrice === null
                ? null
                : round2(startPrice * (1 - discountPct / 100));

        out.push({
            ...r,
            status_label: code === null ? null : code in SELL_STATUS ? SELL_STATUS[code] : `?${code}`,
            is_held: isHeld,
            discount_pct: discountPct,
            price,
        });

        if (isNoBid) noBidCount++;
    }

    return out;
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Lifecycle of the lot from its codes.
 * Terminal = sold (1), seizure revoked (6), cancelled for remaining rounds (26).
 */
export function lotLifecycle(rounds = []) {
    for (const r of rounds) {
        const code = r.statusCode == null ? null : Number(r.statusCode);
        if (code !== null && TERMINAL_CODES.has(code)) {
            return { status: "closed", close_code: code, close_reason: CLOSED_REASON[code] };
        }
    }
    return { status: "active", close_code: null, close_reason: null };
}

/**
 * Nearest round that will actually happen next. No prediction: every price comes
 * from rounds already observed on LED.
 *
 * A slot is a genuine candidate only if it has a date that has not passed.
 * Past-dated `0` slots were skipped by LED and will never be held, so they must
 * not be reported as "next" — otherwise a lot whose first three rounds lapsed
 * would keep pointing back at round 1.
 */
export function nextRound(rounds = [], today = null) {
    const now = today ? new Date(today) : null;

    const candidates = rounds.filter((r) => {
        if (!r.date) return false;
        if (now && new Date(r.date) <= now) return false; // already passed
        return true; // future-dated: held or still pending
    });

    if (!candidates.length) return null;
    const chosen = candidates[0];
    return {
        idx: chosen.idx,
        date: chosen.date,
        price: chosen.price,
        discount_pct: chosen.discount_pct,
        already_held: chosen.is_held,
    };
}

/** Convenience: annotate a scraped row with prices + lifecycle. */
export function priceRow(row, { today = null } = {}) {
    const { start_price, start_price_source, checked } = resolveStartPrice(row.bid?.price ?? {});
    const rounds = priceRounds(row.bid?.rounds ?? [], start_price);
    const life = lotLifecycle(rounds);
    const asOf = today ?? new Date().toISOString().slice(0, 10);
    return {
        ...row,
        bid: {
            ...row.bid,
            rounds,
            price: { ...(row.bid?.price ?? {}), start_price, start_price_source, price_cascade: checked },
        },
        start_price,
        priced_as_of: asOf,
        lifecycle: { ...life, next_round: life.status === "active" ? nextRound(rounds, asOf) : null },
    };
}