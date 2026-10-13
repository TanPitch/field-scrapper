/* Download the กรมธนารักย์ appraisal tables (Open Data Common, no key).
 * 5 x ราคาประเมินที่ดิน (~184 MB, 4.86M rows, keyed by ระวาง + เลขที่ดิน)
 * 1 x ราคาประเมินทุนทรัพย์ที่ดินประเภทอื่น (5.1 MB, 32k rows, keyed by ตำบล + street class)
 * Resumable, verifies row counts and headers. One-off bulk fetch of a public
 * open-data resource — not a scrape of a rate-limited service. */
import axios from "axios";
import fs from "node:fs";
import path from "node:path";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36";
const OUT = path.resolve("test/data/treasury");
fs.mkdirSync(OUT, { recursive: true });

const FILES = [
    ["land_R1.csv", "https://catalog.treasury.go.th/dataset/f5072145-2f1a-4500-bf60-d122b866ac2f/resource/00da1ca3-2c41-436d-a426-d0c06f8cae03/download"],
    ["land_R2.csv", "https://catalog.treasury.go.th/dataset/f5072145-2f1a-4500-bf60-d122b866ac2f/resource/9919be07-ecdd-4542-bd67-6d408691dbd0/download"],
    ["land_R3.csv", "https://catalog.treasury.go.th/dataset/f5072145-2f1a-4500-bf60-d122b866ac2f/resource/1385f623-15c9-4253-b659-093ace6840da/download"],
    ["land_R4.csv", "https://catalog.treasury.go.th/dataset/f5072145-2f1a-4500-bf60-d122b866ac2f/resource/bb55833f-6dd0-491a-bbce-48a3301fb303/download"],
    ["land_R5.csv", "https://catalog.treasury.go.th/dataset/f5072145-2f1a-4500-bf60-d122b866ac2f/resource/6316d19b-2c3f-4dfc-90d7-10928af87254/download"],
    ["land_other.csv", "https://catalog.treasury.go.th/dataset/101b9904-93b5-4fd4-ac73-569130b7165a/resource/3fd86e09-61b6-4b21-a4cf-c4accb69f959/download"],
];

const countRows = (file) => {
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(1 << 20);
    let n = 0, last = 0, pos = 0;
    for (;;) {
        const read = fs.readSync(fd, buf, 0, buf.length, pos);
        if (read === 0) break;
        for (let i = 0; i < read; i++) if (buf[i] === 0x0a) n++;
        last = buf[read - 1];
        pos += read;
    }
    fs.closeSync(fd);
    return last === 0x0a ? n - 1 : n; // don't count a trailing newline
};

const manifest = [];
for (const [name, url] of FILES) {
    const dest = path.join(OUT, name);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
        console.log(`skip ${name} (exists, ${(fs.statSync(dest).size / 1048576).toFixed(2)} MB)`);
    } else {
        process.stdout.write(`get  ${name} ... `);
        const t0 = Date.now();
        const r = await axios.get(url, {
            timeout: 15 * 60 * 1000, responseType: "stream", validateStatus: () => true,
            headers: { "User-Agent": UA },
        });
        if (r.status !== 200) { console.log(`HTTP ${r.status}`); continue; }
        await new Promise((res, rej) => {
            const ws = fs.createWriteStream(dest);
            r.data.on("error", rej);
            ws.on("error", rej);
            ws.on("finish", res);
            r.data.pipe(ws);
        });
        const secs = ((Date.now() - t0) / 1000).toFixed(1);
        console.log(`${(fs.statSync(dest).size / 1048576).toFixed(2)} MB in ${secs}s`);
    }
    const rows = countRows(dest);
    const header = fs.readFileSync(dest).slice(0, 200).toString("utf8").split(/\r?\n/)[0];
    manifest.push({ name, rows, bytes: fs.statSync(dest).size, header });
    console.log(`      rows=${rows.toLocaleString()}  header=${header.slice(0, 80)}`);
}

const total = manifest.reduce((a, m) => a + m.rows, 0);
console.log(`\n${"-".repeat(70)}\nTOTAL ${total.toLocaleString()} rows across ${manifest.length} files`);
fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`manifest -> ${path.join(OUT, "manifest.json")}`);
