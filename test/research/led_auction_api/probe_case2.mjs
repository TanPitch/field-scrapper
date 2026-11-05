// probe_case2.mjs — same sold case, several spellings, to find what the ASP
// indexes it under. ผบE.2225/2567 sold 30/09/2026 per our DB.
//
import { writeFileSync } from "node:fs";

const URL_ = "https://asset.led.go.th/report_new/reports.asp";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function decode(res) {
  const buf = Buffer.from(await res.arrayBuffer());
  const head = buf.subarray(0, 4096).toString("latin1").toLowerCase();
  return /utf-8/.test(head) ? new TextDecoder("utf-8").decode(buf) : new TextDecoder("windows-874").decode(buf);
}

const formRes = await fetch(URL_, {
  headers: { "User-Agent": UA, "Accept-Language": "th,en;q=0.8" },
  signal: AbortSignal.timeout(45000),
});
const sess = (formRes.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");

const VARIANTS = [
  "ผบE.2225", "ผบ.2225", "2225", "ผบ2225", "ผบE .2225",
];

for (const c of VARIANTS) {
  await sleep(2600);
  const res = await fetch(URL_, {
    method: "POST",
    redirect: "follow",
    headers: {
      "User-Agent": UA,
      "Accept-Language": "th,en;q=0.8",
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: URL_,
      Cookie: sess,
    },
    body: new URLSearchParams({
      ALAW_SUIT_NO: c, ALAW_SUIT_YEAR: "2567",
      person1: "", startdate: "", Action: " ค้นหา ",
    }),
    signal: AbortSignal.timeout(45000),
  });
  const html = await decode(res);
  const rows = (html.match(/<tr/gi) ?? []).length;
  const bytes = html.length;
  /* results, if any, ride inside the shell table after the form */
  const culled = html.replace(/<script[\s\S]*?<\/script>/gi, " ");
  const tail = culled.slice(culled.indexOf("ค้นหาข้อมูลการขายทอดตลาด")).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  console.log(`"${c}" → bytes ${bytes} rows ${rows}`);
  console.log("   tail:", tail.slice(0, 400));
}
