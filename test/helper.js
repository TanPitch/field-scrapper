import iconv from 'iconv-lite';


var perftimer = null;

export const timerStart = () => {
    perftimer = performance.now();
};
export const timerEnd = () => {
    const end = performance.now();
    var duration =
        end - perftimer <= 1000
            ? `${(end - perftimer).toFixed(4)} ms`
            : `${((end - perftimer) / 1000).toFixed(4)} s`;
    console.log(duration);
};

// convert TH (543) yyyymmdd to yyyy-mm-dd
// Returns null for missing/blank input — a missing date must not become
// "NaN-NaN-NaN" and poison the row.
export function parseTHdate(dateStr) {
    if (dateStr == null) return null;
    const s = String(dateStr).trim();
    if (!s || !/^\d{8}$/.test(s)) return null;
    const year = parseInt(s.substring(0, 4), 10) - 543;
    const month = s.slice(4, 6);
    const day = s.slice(6, 8);
    return `${year}-${month}-${day}`;
}

// encode TH text
export function encodeTH874(text) {
    const buffer = iconv.encode(text, "win874");
    return Array.from(buffer)
        .map((byte) => "%" + byte.toString(16).toUpperCase())
        .join("");
}

/**
 * Decode an HTML response using the charset the page declares.
 *
 * กรมบังคับคดี used to serve TIS-620 and it now serves UTF-8
 * (`<meta charset="utf-8">`). Decoding UTF-8 bytes as TIS-620 produces mojibake
 * like `เน เธ เน เธ` for `ศาลแพ่ง`, so the charset is sniffed rather than assumed:
 * BOM first, then the meta tag, then UTF-8 as the modern default.
 */
export function decodeHtml(buffer) {
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

    // UTF-8 BOM
    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
        return { text: buf.subarray(3).toString("utf8"), charset: "utf-8 (bom)" };
    }

    // <meta charset="..."> or <meta http-equiv content="...; charset=...">
    const head = buf.subarray(0, 2048).toString("latin1");
    const meta =
        /<meta[^>]+charset\s*=\s*["']?\s*([\w-]+)/i.exec(head)?.[1]?.toLowerCase() ?? null;

    const charset = meta === "tis-620" || meta === "tis620" || meta === "iso-8859-11"
        ? "tis-620"
        : "utf8";

    return { text: iconv.decode(buf, charset), charset: `${charset} (from ${meta ? "meta" : "default"})` };
}
