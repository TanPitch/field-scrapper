#!/usr/bin/env python3
"""
Minimal working client for the reverse-engineered assessprice.treasury.go.th API.
All methods verified live on 2026-10-21. Public data, no auth required.

Usage:
    python3 assessprice_client.py
"""
import json
import math
import time
import urllib.parse
import urllib.request

BASE = "https://assessprice.treasury.go.th/assessprice/services/DataService.svc/DS_TRANSIT"

GUEST = {
    "USER_TYPE": "G",
    "USER_ID": "2",
    "CSRF_TOKEN": "BUpOX4Vtg0GfnRwOu2jLZw==",
    "VISITOR_UUID": "b104bccbd4f1c6c3b2c05dad3a929eb6",
    "FLAG_DVALUE": "1",
    "MB_FLAG": "0",
    "WEB_FLAG": "1",
    "LANGUAGE": "TH",
}


def call(sp=None, timeout=45, retries=2, **params):
    """POST a DS_TRANSIT call. Usage: call(SP='GIS5_Q_PARCEL', CHANOD_NO='4878', ...)"""
    if sp:
        params["SP"] = sp
    data = urllib.parse.urlencode(params).encode()
    last_err = None
    for _ in range(retries + 1):
        req = urllib.request.Request(
            BASE, data=data,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            method="POST")
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
        except Exception as e:
            last_err = e
            time.sleep(1.5)
    raise RuntimeError(f"API call failed: {last_err}")


def lookup_provinces():
    """77 provinces -> [{CODE, DESCR}]"""
    return call(SP="LUT_Q_BND", SYS_ID="GIS5")["data"]


# --- Coordinate conversion ---------------------------------------------------
# Parcel DB uses SRID 24047 = UTM 47N on the INDIAN 1975 datum (not WGS84).
# Verified against live data: chanod 4878 SHAPE POINT(669075 1515862) @ SRID 24047.
A_IND, F_IND = 6377276.345, 298.8017          # Indian 1975 ellipsoid
E2_IND = 2 / F_IND - 1 / F_IND ** 2
K0, LON0 = 0.9996, 99.0                        # UTM 47N central meridian
# Indian 1975 -> WGS84 Molodensky shift (standard Thai params)
_MDX, _MDY, _MDZ = 199.0, 831.0, 317.0


def _utm_fwd_ind1975(lat, lon):
    a, e2 = A_IND, E2_IND
    ep2 = e2 / (1 - e2)
    phi = math.radians(lat); dlam = math.radians(lon - LON0)
    N = a / math.sqrt(1 - e2 * math.sin(phi) ** 2)
    T = math.tan(phi) ** 2
    C = ep2 * math.cos(phi) ** 2
    A_ = math.cos(phi) * dlam
    M = a * ((1 - e2/4 - 3*e2**2/64 - 5*e2**3/256) * phi
             - (3*e2/8 + 3*e2**2/32 + 45*e2**3/1024) * math.sin(2*phi)
             + (15*e2**2/256 + 45*e2**3/1024) * math.sin(4*phi)
             - (35*e2**3/3072) * math.sin(6*phi))
    x = K0*N*(A_ + (1-T+C)*A_**3/6 + (5-18*T+T**2+72*C-58*ep2)*A_**5/120) + 500000
    y = K0*(M + N*math.tan(phi)*(A_**2/2 + (5-T+9*C+4*C**2)*A_**4/24
            + (61-58*T+T**2+600*C-330*ep2)*A_**6/720))
    return x, y


def _molodensky(lat, lon, dx, dy, dz):
    """Apply a 3-param Molodensky datum shift (degrees in/out)."""
    a, f = A_IND, 1 / F_IND
    b = a * (1 - f)
    e2a = 2 * f - f * f
    lat_r, lon_r = math.radians(lat), math.radians(lon)
    sl, cl = math.sin(lat_r), math.cos(lat_r)
    so, co = math.sin(lon_r), math.cos(lon_r)
    N = a / math.sqrt(1 - e2a * sl ** 2)
    M = a * (1 - e2a) / (1 - e2a * sl ** 2) ** 1.5
    da = 6378137.0 - a
    df = (1 / 298.257223563) - f
    dlat = (-dx*sl*cl - dy*sl*so + dz*cl
            + da*(N*e2a*sl*cl)/a + df*(M*a/b + N*b/a)*sl*cl) / M
    dlon = (-dx*so + dy*co) / (N * cl)
    return math.degrees(lat_r + dlat), math.degrees(lon_r + dlon)


def wgs84_to_utm47(lat, lon):
    """WGS84 lon/lat -> Indian 1975 UTM 47N meters (SRID 24047), ~40 m accuracy."""
    lat75, lon75 = _molodensky(lat, lon, -_MDX, -_MDY, -_MDZ)  # WGS84 -> Indian1975
    return _utm_fwd_ind1975(lat75, lon75)


def identify(lon, lat):
    """Find the assessed parcel at a WGS84 lon/lat point (Thailand).
    Tries the exact converted point, then a small 3x3 grid fallback."""
    x, y = wgs84_to_utm47(lat, lon)
    out = []
    for dx, dy in [(0, 0), (60, 0), (-60, 0), (0, 60), (0, -60),
                   (60, 60), (60, -60), (-60, 60), (-60, -60)]:
        geo = f"POINT ({x+dx:.0f} {y+dy:.0f})"
        for layer in ("PARCEL", "NS3K"):
            r = call(SP="GIS5_Q_IDEN", PARCEL_LAYER=layer, GEO_47=geo, GEO_48=geo, **GUEST)
            if r.get("data"):
                out.extend(r["data"])
        if out:
            break
    return out


def search_chanod(chanod_no, prov_code, survey_no="", land_no=""):
    """Search assessed land by title-deed number.
    prov_code: province code from lookup_provinces() (e.g. '10' = Bangkok)."""
    p = {
        "SP": "GIS5_Q_PARCEL", "PARCEL_LAYER": "PARCEL", "PARCEL_TYPE": "1",
        "PERIODS": "7", "BEGIN": "1", "END": "20",
        "PROV_CODE": str(prov_code),          # NOT CHANGWAT_CODE!
        "CHANOD_NO": str(chanod_no),
        "SURVEY_NO": str(survey_no or ""),
    }
    if land_no:
        p["LAND_NO"] = str(land_no)
    p.update(GUEST)
    return call(**p)


def search_condo(prov_code, begin=1, end=20):
    """Condominium projects with assessment data in a province."""
    return call(SP="GIS5_Q_CONDO", PARCEL_LAYER="CONDO",
                PROV_CODE=str(prov_code), BEGIN=begin, END=end, **GUEST)


def search_construction(prov_code, begin=1, end=20):
    """Building/structure valuation types in a province."""
    return call(SP="GIS5_Q_CONSTRUCTION", PARCEL_LAYER="BUILDING",
                PROV_CODE=str(prov_code), BEGIN=begin, END=end, **GUEST)


def area_by_postcode(postcode):
    return call(SP="GIS5_Q_AREA_POSTCODE", POSTCODE=str(postcode))["data"]


def area_autocomplete(keyword):
    """Thai address free-text autocomplete -> DISPLAY_TEXT + LAT/LONG."""
    return call(SP="GIS5_Q_AREA_FT", KEYWORD=keyword)["data"]


def land_offices(prov_code, begin=1, end=30):
    """Land offices (name, address, phone, jurisdiction, coordinates)."""
    return call(SP="GIS5_Q_DOL", PROV_CODE=str(prov_code),
                BEGIN=begin, END=end, USER_ID=GUEST["USER_ID"], **GUEST)["data"]


if __name__ == "__main__":
    print("== Provinces (first 3) ==")
    print(json.dumps(lookup_provinces()[:3], ensure_ascii=False, indent=1))

    print("\n== Identify parcel at Victory Monument (100.5776, 13.7691) ==")
    for row in identify(100.5776, 13.7691):
        print(" ", row.get("TITLE", "").replace("<br/>", " | ")[:120])
        print("  price:", row.get("CURR_EVAPRICE"), "| chanod:", row.get("CHANOD_NO"))

    print("\n== Chanod 4878 in Bangkok ==")
    r = search_chanod("4878", "10", survey_no="143")
    print("  success:", r["success"], "total:", r["total"])
    if r["data"]:
        print("  price:", r["data"][0].get("CURR_EVAPRICE"), "THB/sq.wa")

    print("\n== Condos in Bangkok (first 3) ==")
    r = search_condo("10", 1, 3)
    for c in r["data"]:
        print("  ", c.get("CONDO_ID"), c.get("TITLE", "").strip(), "|", c.get("AMPHUR_NAME"))

    print("\n== Postcode 10110 ==")
    print(" ", area_by_postcode("10110"))
