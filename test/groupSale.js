/* groupSale.js — read the group-sale note LED attaches to bankruptcy lots.
 *
 * LED writes a free-text remark on a lot that is being sold as part of a group:
 *
 *   "เป็นการขายกลุ่มที่  4, ขายรวม (แปลงที่ 40 - 72) รวม 33 แปลง, ราคาประเมินรวม 17,329,950.-บาท"
 *
 * Only two numbers in it are worth keeping: how many lots are in the group, and
 * what the group is assessed at. The group number and the plot range are
 * deliberately not parsed - nothing downstream uses them, and every extra field
 * is another thing that can drift from what LED actually writes.
 *
 * These two are kept because they make the row checkable. Every lot in a group
 * carries the *same* assessed total, not a share of it, so:
 *   - group_total must equal that lot's own start_price, and
 *   - the number of lots sharing a ลำดับการขาย must equal the declared count.
 * Either mismatch means the scrape is incomplete or a lot went missing.
 */

/** Thai and Arabic digits both appear in LED output. */
const DIGITS = { "๐": "0", "๑": "1", "๒": "2", "๓": "3", "๔": "4", "๕": "5", "๖": "6", "๗": "7", "๘": "8", "๙": "9" };

function normalise(s) {
    return String(s ?? "").replace(/[๐-๙]/g, (c) => DIGITS[c] ?? c);
}

/** "17,329,950" -> 17329950. Returns null rather than NaN so callers must handle it. */
function toMoney(s) {
    if (!s) return null;
    const cleaned = normalise(s).replace(/[,\s฿]/g, "");
    if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
}

/**
 * @returns {{lotCount: number, totalPrice: number} | null}
 *   null when the remark is absent or does not look like a group sale. A lot
 *   sold individually carries an unrelated note and must not be read as one.
 */
export function parseGroupSaleRemark(remark) {
    const s = normalise(remark);
    if (!s) return null;
    /* Both numbers must be present. Half a group sale is not usable as a check,
       and guessing which half is missing would be worse than not checking. */
    const mCount = s.match(/รวม\s*([\d,]+)\s*แปลง/);
    const mTotal = s.match(/ราคาประเมินรวม\s*([\d,]+)/);
    if (!mCount || !mTotal) return null;
    const lotCount = Number(mCount[1].replace(/,/g, ""));
    const totalPrice = toMoney(mTotal[1]);
    if (!Number.isFinite(lotCount) || lotCount <= 0 || totalPrice == null) return null;
    return { lotCount, totalPrice };
}

/**
 * Check one group-sale lot against what actually landed in the database.
 *
 * `siblings` is every lot sharing the same ลำดับการขาย, including this one.
 * Returns the problems found; an empty array means the data agrees with LED.
 */
export function checkGroupSale(lot, siblings) {
    const problems = [];
    const g = parseGroupSaleRemark(lot.remark);
    if (!g) return problems;

    if (lot.startPrice != null && lot.startPrice !== g.totalPrice) {
        problems.push(
            `assessed total disagrees: remark ${g.totalPrice} vs lot ${lot.startPrice} ` +
            `(lot ${lot.caseNo}/${lot.caseYear} ${lot.deedNo ?? "?"} order ${lot.orderLabel ?? "?"})`,
        );
    }

    /* Only judge the count once the whole group is present. A partial scrape
       would otherwise report every group as short. */
    if (lot.completeGroup && siblings.length !== g.lotCount) {
        problems.push(
            `lot count disagrees: remark says ${g.lotCount}, scraped ${siblings.length} ` +
            `(lot ${lot.caseNo}/${lot.caseYear} order ${lot.orderLabel ?? "?"})`,
        );
    }
    return problems;
}