/* Fetch the LED cadastral survey drawings for the น.ส.3ก. parcels.
 *
 * The ระวาง (map sheet number) is printed on the drawing, and it is the one key
 * กรมธนารักย์'s NS3K search needs and the one thing LED never exposes as text.
 * LED publishes it only as an image.
 *
 * Two bugs in the first attempt, both worth remembering:
 *   - Thai path segments (งานล้ม) must be percent-encoded or the CDN 404s
 *   - output paths must resolve from the script's own directory
 */
import axios from "axios";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "data");
const WANT = new Set(["2771", "2772", "2773", "2774", "97"]);

const rows = JSON.parse(fs.readFileSync(path.join(HERE, "out", "rows.json"), "utf8"));
let got = 0;

for (const lot of rows) {
    const deeds = lot.address?.deeds?.numbers ?? [];
    for (const deed of deeds) {
        if (!WANT.has(String(deed))) continue;
        for (const im of lot.images ?? []) {
            if (!im.url) continue;
            const u = new URL(im.url);
            const encoded = `${u.origin}${u.pathname.split("/").map(encodeURIComponent).join("/")}`;
            const file = path.join(OUT, `survey_${deed}_${im.kind}.jpg`);
            try {
                const r = await axios.get(encoded, {
                    responseType: "arraybuffer", timeout: 60000, validateStatus: () => true,
                    headers: { "User-Agent": "Mozilla/5.0", Referer: "https://asset.led.go.th/" },
                });
                const buf = Buffer.from(r.data);
                if (buf[0] === 0xFF && buf[1] === 0xD8) {
                    fs.writeFileSync(file, buf);
                    got++;
                    console.log(`${deed}  ${im.kind.padEnd(7)} ${String(buf.length).padStart(8)} bytes  ${path.basename(file)}`);
                } else {
                    console.log(`${deed}  ${im.kind.padEnd(7)} not a JPEG (${r.headers["content-type"]})`);
                }
            } catch (e) {
                console.log(`${deed}  ${im.kind.padEnd(7)} ERR ${e.code ?? e.message}`);
            }
        }
    }
}
console.log(`\n${got} image(s) saved to ${OUT}`);
console.log("The ระวาง is printed on the survey ('j') drawing — open those next.");
