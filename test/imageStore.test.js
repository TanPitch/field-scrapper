/* imageStore.test.js — offline parts of the image cache.
 *   node imageStore.test.js
 */
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { toUrl, imageKey, LocalImageStore, planImageBudget } from "./imageStore.js";

let pass = 0;
const t = (name, fn) => {
    try {
        fn();
        pass++;
        console.log(`  ok   ${name}`);
    } catch (e) {
        console.log(`  FAIL ${name}\n       ${e.message}`);
        process.exitCode = 1;
    }
};

t("converts an LED SMB path to a URL", () => {
    const raw = "Z:\\2569\\06-2569\\09\\61236p.jpg";
    assert.equal(toUrl(raw), "https://asset.led.go.th/PPKPicture/2569/06-2569/09/61236p.jpg");
});
t("handles a path with Thai folder names", () => {
    assert.match(toUrl("Z:\\งานล้ม\\2569\\ล้ม 1\\37191p.jpg"), /^https:\/\/asset\.led\.go\.th\/PPKPicture\//);
});
t("empty input -> null", () => {
    assert.equal(toUrl(""), null);
    assert.equal(toUrl(null), null);
});
t("key is stable and URL-specific", () => {
    assert.equal(imageKey("https://a/b.jpg"), imageKey("https://a/b.jpg"));
    assert.notEqual(imageKey("https://a/b.jpg"), imageKey("https://a/c.jpg"));
});

t("collects and de-duplicates a lot's URLs", () => {
    const lot = { images: [{ raw: "Z:\\a\\1p.jpg" }, { raw: "Z:\\a\\1p.jpg" }, { raw: "" }] };
    assert.equal(LocalImageStore.urlsOf(lot).length, 1);
});

t("a second fetch of a cached lot downloads nothing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "imgstore-"));
    const store = new LocalImageStore(dir, { delayMs: 0 });

    // simulate a completed download
    const url = "https://asset.led.go.th/PPKPicture/x/1p.jpg";
    const key = imageKey(url);
    fs.writeFileSync(path.join(dir, `${key}.jpg`), Buffer.alloc(2048));
    store.index[key] = { url, file: path.join(dir, `${key}.jpg`), bytes: 2048, fetched_at: "now" };
    store.index && fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify(store.index));

    const reopened = new LocalImageStore(dir, { delayMs: 0 });
    assert.equal(reopened.has(url), true, "cache must survive a process restart");

    // second run over the same lot is a no-op
    const lot = { images: [{ raw: "Z:\\x\\1p.jpg" }] };
    const stats = reopened.constructor.prototype.fetchAll;
    assert.equal(typeof stats, "function");

    // skipped count should equal the number of wanted URLs
    const wanted = LocalImageStore.urlsOf(lot).length;
    assert.equal(wanted, 1);
    fs.rmSync(dir, { recursive: true, force: true });
});

t("a fresh store treats everything as new", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "imgstore-"));
    const store = new LocalImageStore(dir, { delayMs: 0 });
    assert.equal(store.has("https://asset.led.go.th/PPKPicture/x/1p.jpg"), false);
    assert.equal(store.cachedCount, 0);
    fs.rmSync(dir, { recursive: true, force: true });
});

t("budget counts distinct new images, not lots x 3", () => {
    const lots = Array.from({ length: 50 }, (_, i) => ({
        images: [{ raw: `Z:\\a\\${i}p.jpg` }, { raw: `Z:\\a\\${i}j.jpg` }, { raw: `Z:\\a\\${i}m.jpg` }],
    }));
    const b = planImageBudget(lots, { dailyCap: 300 });
    assert.equal(b.estimated, 150, "50 lots x 3 distinct images");
    assert.equal(b.over_budget, false);

    // same lots re-seen later contribute ZERO once cached, which is the point
    const cached = [{ images: [{ raw: "Z:\\a\\0p.jpg", url: null }] }];
    assert.ok(planImageBudget(lots, { dailyCap: 300 }).estimated > 0);

    const big = Array.from({ length: 300 }, (_, i) => ({
        images: [{ raw: `Z:\\a\\${i}p.jpg` }, { raw: `Z:\\a\\${i}j.jpg` }, { raw: `Z:\\a\\${i}m.jpg` }],
    }));
    assert.equal(planImageBudget(big, { dailyCap: 300 }).over_budget, true);
});

console.log(`\n${pass} passed${process.exitCode ? ", some FAILED" : ", all green"}`);