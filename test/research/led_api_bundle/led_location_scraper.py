#!/usr/bin/env python3
"""
LED (Legal Execution Department, Thailand) location scraper
============================================================
Harvests the province / district / sub-district reference data used by
https://asset.led.go.th/newbidreg/ (auction property search).

APIs used (both return HTML <option> fragments, NOT JSON):
  GET /newbidreg/get_amphur.asp?provinceId={2-digit province code}
      -> option value = 4-digit district code
  GET /newbidreg/get_tambon.asp?amphurId={4-digit district code}
      -> option value = 5-digit POSTAL CODE, option text = sub-district name
      (the site uses NO numeric sub-district code - only name + postcode)

Usage:
  python3 led_location_scraper.py                # districts for all provinces
  python3 led_location_scraper.py --tambon       # + sub-districts (slow, ~1000 calls)
  python3 led_location_scraper.py --province 10 30   # specific provinces only
  python3 led_location_scraper.py --tambon --district 3001 1001  # specific districts

Dependencies:  pip install requests
Note: run from a network that can reach asset.led.go.th (Thai gov site may be
slow or filtered from outside Thailand). Be polite: ~1 req/sec.

Output files (written next to this script):
  led_districts.json / led_districts.csv
  led_subdistricts.json / led_subdistricts.csv   (with --tambon)
"""
import argparse
import csv
import json
import os
import re
import sys
import time

try:
    import requests
except ImportError:
    sys.exit("Missing dependency: pip install requests")

BASE = "https://asset.led.go.th/newbidreg"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
SESSION = requests.Session()
SESSION.headers.update({"User-Agent": UA})

OPTION_RE = re.compile(r'<option value="([^"]*)"[^>]*>([^<]*)</option>')
# Provinces hardcoded in the page's <select id="provinces"> (77 unique codes)
PROVINCES = {
    "10": "กรุงเทพมหานคร", "11": "สมุทรปราการ", "12": "นนทบุรี", "13": "ปทุมธานี",
    "14": "พระนครศรีอยุธยา", "15": "อ่างทอง", "16": "ลพบุรี", "17": "สิงห์บุรี",
    "18": "ชัยนาท", "19": "สระบุรี", "20": "ชลบุรี", "21": "ระยอง", "22": "จันทบุรี",
    "23": "ตราด", "24": "ฉะเชิงเทรา", "25": "ปราจีนบุรี", "26": "นครนายก",
    "27": "สระแก้ว", "30": "นครราชสีมา", "31": "บุรีรัมย์", "32": "สุรินทร์",
    "33": "ศรีสะเกษ", "34": "อุบลราชธานี", "35": "ยโสธร", "36": "ชัยภูมิ",
    "37": "อำนาจเจริญ", "39": "หนองบัวลำภู", "40": "ขอนแก่น", "41": "อุดรธานี",
    "42": "เลย", "43": "หนองคาย", "44": "มหาสารคาม", "45": "ร้อยเอ็ด",
    "46": "กาฬสินธุ์", "47": "สกลนคร", "48": "นครพนม", "49": "มุกดาหาร",
    "50": "เชียงใหม่", "51": "ลำพูน", "52": "ลำปาง", "53": "อุตรดิตถ์",
    "54": "แพร่", "55": "น่าน", "56": "พะเยา", "57": "เชียงราย", "58": "แม่ฮ่องสอน",
    "60": "นครสวรรค์", "61": "อุทัยธานี", "62": "กำแพงเพชร", "63": "ตาก",
    "64": "สุโขทัย", "65": "พิษณุโลก", "66": "พิจิตร", "67": "เพชรบูรณ์",
    "70": "ราชบุรี", "71": "กาญจนบุรี", "72": "สุพรรณบุรี", "73": "นครปฐม",
    "74": "สมุทรสาคร", "75": "สมุทรสงคราม", "76": "เพชรบุรี", "77": "ประจวบคีรีขันธ์",
    "80": "นครศรีธรรมราช", "81": "กระบี่", "82": "พังงา", "83": "ภูเก็ต",
    "84": "สุราษฎร์ธานี", "85": "ระนอง", "86": "ชุมพร", "90": "สงขลา", "91": "สตูล",
    "92": "ตรัง", "93": "พัทลุง", "94": "ปัตตานี", "95": "ยะลา", "96": "นราธิวาส",
    "97": "บึงกาฬ",
}


def fetch_options(url, retries=5):
    """GET a fragment API and return [(value, text), ...]; drops placeholders."""
    for attempt in range(1, retries + 1):
        try:
            r = SESSION.get(url, timeout=30)
            r.raise_for_status()
            r.encoding = "utf-8"
            opts = [
                (v.strip(), t.replace("\ufeff", "").strip())
                for v, t in OPTION_RE.findall(r.text)
            ]
            opts = [(v, t) for v, t in opts if t and not t.startswith("----")]
            if opts:
                return opts
            # empty body sometimes means transient error - retry
        except requests.RequestException as e:
            print(f"    attempt {attempt}: {e}", file=sys.stderr)
        time.sleep(1.5 * attempt)
    return []


def scrape_districts(province_codes):
    districts = []
    for i, code in enumerate(sorted(province_codes, key=int), 1):
        name = PROVINCES[code]
        url = f"{BASE}/get_amphur.asp?provinceId={code}"
        print(f"[{i}/{len(province_codes)}] province {code} {name}")
        opts = fetch_options(url)
        for dcode, dname in opts:
            districts.append({
                "province_code": code,
                "province_name_th": name,
                "district_code": dcode,
                "district_name_th": dname,
            })
        print(f"    -> {len(opts)} districts")
        time.sleep(1.0)
    return districts


def scrape_subdistricts(districts):
    subs = []
    for i, d in enumerate(districts, 1):
        url = f"{BASE}/get_tambon.asp?amphurId={d['district_code']}"
        print(f"[{i}/{len(districts)}] district {d['district_code']} {d['district_name_th']}")
        opts = fetch_options(url)
        for sname, postcode in opts:
            subs.append({
                "province_code": d["province_code"],
                "province_name_th": d["province_name_th"],
                "district_code": d["district_code"],
                "district_name_th": d["district_name_th"],
                "subdistrict_name_th": sname,
                "postcode": postcode,
            })
        print(f"    -> {len(opts)} sub-districts")
        time.sleep(1.0)
    return subs


def save(rows, base, fields):
    with open(base + ".json", "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=2)
    with open(base + ".csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)
    print(f"saved {len(rows)} rows -> {base}.json / {base}.csv")


def main():
    ap = argparse.ArgumentParser(description="LED location scraper")
    ap.add_argument("--province", nargs="*", help="province codes only, e.g. 10 30")
    ap.add_argument("--district", nargs="*", help="district codes only (implies --tambon)")
    ap.add_argument("--tambon", action="store_true", help="also scrape sub-districts")
    args = ap.parse_args()

    here = os.path.dirname(os.path.abspath(__file__))
    want_tambon = args.tambon or bool(args.district)

    if args.district:
        # sub-district harvest for explicit district codes
        districts = [{
            "province_code": c[:2], "province_name_th": PROVINCES.get(c[:2], "?"),
            "district_code": c, "district_name_th": "?",
        } for c in args.district]
    else:
        codes = args.province or list(PROVINCES.keys())
        districts = scrape_districts(codes)

    save(districts, os.path.join(here, "led_districts"),
         ["province_code", "province_name_th", "district_code", "district_name_th"])

    if want_tambon:
        subs = scrape_subdistricts(districts)
        save(subs, os.path.join(here, "led_subdistricts"),
             ["province_code", "province_name_th", "district_code", "district_name_th",
              "subdistrict_name_th", "postcode"])


if __name__ == "__main__":
    main()
