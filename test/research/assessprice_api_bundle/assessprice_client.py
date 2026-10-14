#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
assessprice_client.py — Unofficial Python client for the Treasury Department (กรมธนารักษ์)
asset-price assessment service behind https://assessprice.treasury.go.th/

Everything below was reverse-engineered from the site's own network traffic
and verified with live requests (Oct 2026). No login/CSRF is required —
the public guest mode (USER_ID=2) is enough.

HOW THE SITE WORKS
-----------------
The SPA wraps every backend query in ONE endpoint (a stored-procedure
transit service) reached through an ASP.NET proxy:

    POST https://assessprice.treasury.go.th/assessprice/ashx/Proxy.ashx?https://assessprice.treasury.go.th/assessprice/services/DataService.svc/DS_TRANSIT?
    Content-Type: application/x-www-form-urlencoded

    SP=<procedure name>&<other params...>

The `SP` parameter selects the query; everything else is a filter.
Response JSON: {"success": bool, "total": int, "message": str, "data": [...]}

KEY STORED PROCEDURES (SP)
--------------------------
  LUT_Q_BND      province / district / subdistrict cascading dropdowns
  LUT_Q_DOL      land-office (สำนักงานที่ดิน) list per province
  LUT_Q_PERIODS  assessment periods (currently 2566-2569, PERIODS_ID=7)
  GIS5_Q_PARCEL  land-parcel search by โฉนด no. / เลขที่ดิน
  GIS5_Q_CONDO   condominium-unit search
  GIS5_Q_CONSTRUCTION building search

Requires: Python 3.7+ (stdlib only)
"""

import json
import time
import uuid
import urllib.request
import urllib.parse
from typing import Optional, List, Dict, Any

# ---------------------------------------------------------------- constants

BASE = "https://assessprice.treasury.go.th/assessprice"
PROXY = f"{BASE}/ashx/Proxy.ashx?"
DS_TRANSIT = f"{BASE}/services/DataService.svc/DS_TRANSIT"

GUEST_USER_ID = "2"          # public/guest user
CURRENT_PERIOD = "7"         # 2566-2569

_HEADERS = {
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "Accept": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Origin": "https://assessprice.treasury.go.th",
    "Referer": "https://assessprice.treasury.go.th/",
}

# strip params whose value is None/"" (the site's request class does the same)
_DROP = lambda v: v is None or v == ""


def _clean(params: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in params.items() if not _DROP(v)}


class AssessPriceClient:
    def __init__(self, visitor_uuid: Optional[str] = None, timeout: int = 60):
        # The site requires a VISITOR_UUID (any random hex works — verified)
        self.visitor_uuid = visitor_uuid or uuid.uuid4().hex
        self.timeout = timeout

    # ------------------------------------------------------------ transport
    def _post(self, params: Dict[str, Any]) -> Dict[str, Any]:
        body = urllib.parse.urlencode(_clean(params)).encode("utf-8")
        url = PROXY + DS_TRANSIT + "?"        # trailing '?' matters (preventCache)
        req = urllib.request.Request(url, data=body, headers=_HEADERS, method="POST")
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def _sp(self, sp: str, **params) -> Dict[str, Any]:
        params["SP"] = sp
        return self._post(params)

    # ------------------------------------------------- 1. dropdown lookups
    def get_provinces(self) -> List[Dict[str, str]]:
        """จังหวัด — returns [{'CODE': '10', 'DESCR': 'กรุงเทพมหานคร'}, ...] (77)."""
        r = self._sp("LUT_Q_BND", SYS_ID="GIS5")
        return r.get("data", [])

    def get_districts(self, prov_code: str, layer: Optional[str] = None) -> List[Dict[str, str]]:
        """อำเภอ/เขต of one province.

        layer="PARCEL" reproduces the deed-form behaviour (adds a special
        'whole province' pseudo-entry such as 98:กรุงเทพมหานคร for BKK).
        """
        r = self._sp("LUT_Q_BND", PROV_CODE=prov_code, SYS_ID="GIS5", LAYER=layer)
        return r.get("data", [])

    def get_subdistricts(self, prov_code: str, amph_code: str) -> List[Dict[str, str]]:
        """ตำบล/แขวง of one district."""
        r = self._sp("LUT_Q_BND", PROV_CODE=prov_code, AMPH_CODE=amph_code, SYS_ID="GIS5")
        return r.get("data", [])

    def get_land_offices(self, prov_code: str) -> List[Dict[str, str]]:
        """สำนักงานที่ดิน (DOL branches) of one province.

        Returns e.g. {'CODE': '10000000', 'DESCR': 'สำนักงานที่ดินกรุงเทพมหานคร'}.
        """
        r = self._sp("LUT_Q_DOL", PROV_CODE=prov_code)
        return r.get("data", [])

    def get_periods(self) -> List[Dict[str, Any]]:
        """Assessment periods, e.g. [{'PERIODS_ID': 7, 'PERIODS_NAME': '2566 - 2569'}]."""
        r = self._sp("LUT_Q_PERIODS")
        return r.get("data", [])

    # ----------------------------------------------- 2. land-parcel search
    def _parcel(self, **filters) -> Dict[str, Any]:
        base = {
            "PERIODS": CURRENT_PERIOD,
            "PARCEL_LAYER": "PARCEL",   # PARCEL = ที่ดิน (น.ส.4จ), NS3K = น.ส.3ก
            "LANGUAGE": "TH",
            "USER_ID": GUEST_USER_ID,
            "BEGIN": 1,                 # pagination: BEGIN/END row numbers
            "END": 20,
            "VISITOR_UUID": self.visitor_uuid,
            "FLAG_DVALUE": 1,
        }
        base.update(filters)
        return self._sp("GIS5_Q_PARCEL", **base)

    def search_by_chanod(self, chanod_no: str, prov_code: str,
                         survey_no: Optional[str] = None,
                         prov_descr: Optional[str] = None,
                         dol_code: Optional[str] = None,
                         amph_code: Optional[str] = None,
                         tumb_code: Optional[str] = None,
                         page: int = 1, page_size: int = 20) -> Dict[str, Any]:
        """ค้นหาที่ดินจากเลขที่โฉนด (title-deed number).

        NOTE: chanod numbers are NOT unique across land offices — the same
        number can exist in several provinces. Pass survey_no (หน้าสำรวจ)
        or dol_code (สำนักงานที่ดิน) to disambiguate, or paginate.
        """
        return self._parcel(
            CHANOD_NO=chanod_no, SURVEY_NO=survey_no,
            PARCEL_TYPE="CHANOD_NO",
            PROV_CODE=prov_code, PROV_DESCR=prov_descr,
            DOL_CODE=dol_code, ORG_CODE=dol_code,
            AMPH_CODE=amph_code, TUMB_CODE=tumb_code,
            BEGIN=(page - 1) * page_size + 1, END=page * page_size,
        )

    def search_by_land_no(self, land_no: str, prov_code: str,
                          utm_map1: str,           # แผนที่ภูมิประเทศ e.g. "5136III"
                          utm_map3: Optional[str] = None,   # ระวาง  e.g. "6414"
                          utm_map4: Optional[str] = None,   # แผ่นที่ e.g. "04"
                          prov_descr: Optional[str] = None,
                          dol_code: Optional[str] = None,
                          page: int = 1, page_size: int = 20) -> Dict[str, Any]:
        """ค้นหาที่ดินจากเลขที่ดิน (land number) + ระวาง (UTM map sheet).

        utm_map1 is the topo map e.g. "5136III" (province zone 47/48 sheet).
        Verified example: land 1693, sheet 5136III, range 6414, leaf 04,
        PROV 10 -> chanod 29139, Bang Rak, 120,000 baht/sq.wa.
        """
        return self._parcel(
            LAND_NO=land_no, UTM=utm_map1, UTM_MAP1=utm_map1,
            UTM_MAP3=utm_map3, UTM_MAP4=utm_map4,
            PARCEL_TYPE="LAND_NO",
            PROV_CODE=prov_code, PROV_DESCR=prov_descr,
            DOL_CODE=dol_code, ORG_CODE=dol_code,
            BEGIN=(page - 1) * page_size + 1, END=page * page_size,
        )

    # ----------------------------------------------------------- 3. helpers
    @staticmethod
    def summarize(rec: Dict[str, Any]) -> Dict[str, Any]:
        """Extract the useful flat fields from one parcel record."""
        keys = ["CHANOD_NO", "LAND_NO", "SURVEY_NO", "RAWANG", "AMPHUR_NAME",
                "TUMBON_NAME", "DOL_NAME", "CURR_EVAPRICE", "BRANCH_CODE",
                "CHANGWAT_CODE", "LAND_NO_TH", "PARCEL_TYPE", "LAYER_NAME",
                "RN", "NS3A_ID"]
        return {k: rec.get(k) for k in keys if k in rec}


# ------------------------------------------------------------------- demo
if __name__ == "__main__":
    c = AssessPriceClient()

    print("== periods ==")
    for p in c.get_periods():
        print(" ", p["PERIODS_ID"], p["PERIODS_NAME"])

    print("== first 5 provinces ==")
    for p in c.get_provinces()[:5]:
        print(f"  {p['CODE']:>3}  {p['DESCR']}")

    print("== districts of Bangkok (10), first 5 ==")
    for d in c.get_districts("10")[:5]:
        print(f"  {d['CODE']:>3}  {d['DESCR']}")

    print("== land offices of Bangkok, first 3 ==")
    for d in c.get_land_offices("10")[:3]:
        print(f"  {d['CODE']}  {d['DESCR']}")

    print("== search by chanod 29139 + survey 18637 (BKK) ==")
    r = c.search_by_chanod("29139", "10", survey_no="18637",
                           prov_descr="กรุงเทพมหานคร")
    print("  success:", r["success"], "| total:", r["total"])
    for rec in r.get("data", []):
        print("  ", json.dumps(c.summarize(rec), ensure_ascii=False))

    print("== search by land no 1693, sheet 5136III, range 6414, leaf 04 ==")
    r = c.search_by_land_no("1693", "10", "5136III", "6414", "04",
                            prov_descr="กรุงเทพมหานคร")
    print("  success:", r["success"], "| total:", r["total"])
    for rec in r.get("data", []):
        print("  ", json.dumps(c.summarize(rec), ensure_ascii=False))
