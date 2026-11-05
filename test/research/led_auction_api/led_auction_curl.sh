#!/usr/bin/env bash
# LED Auction Results - cURL verification recipe (companion sample)
# Report: "LED Auction Results API - Integration and Reference Report"
#
# Verifies the reports.asp contract in two calls before any code is written.
# Parameter names below are PLACEHOLDERS - replace them with the values
# captured in DevTools (report Section 3.3) and mark the capture date.
#
# Usage:  bash led_auction_curl.sh
set -euo pipefail

BASE="https://asset.led.go.th"
FORM_URL="${BASE}/report/reports.asp"
# TODO(verify): submission target captured in DevTools
RESULT_URL="${BASE}/report/report_result.asp"    # PLACEHOLDER
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

echo "== Step 1: fetch the form and keep the session cookie =="
curl -sS -c cookies.txt \
     -A "$UA" \
     --max-time 45 \
     "$FORM_URL" -o form.html
echo "form.html: $(wc -c < form.html) bytes"

echo "== Step 2: submit the search (field names TBD via DevTools) =="
# NOTE: if the captured request is a GET, move these into the query string
#       and drop --data-urlencode.
curl -sS -b cookies.txt \
     -A "$UA" \
     --max-time 45 \
     --data-urlencode "case_no=1151/2545" \
     --data-urlencode "year_be=2545" \
     --data-urlencode "plaintiff=" \
     --data-urlencode "sale_date=" \
     "$RESULT_URL" \
     -o result.html \
     -w "HTTP %{http_code} in %{time_total}s\n" || {
  echo "submission failed - check RESULT_URL and field names"; exit 1; }

echo "== Step 3: transcode if the response is TIS-620 / windows-874 =="
if grep -qiE "windows-874|tis-620" form.html result.html 2>/dev/null; then
  iconv -f TIS-620 -t UTF-8 result.html -o result.utf8.html
  mv result.utf8.html result.html
  echo "transcoded to UTF-8"
fi

echo "== Step 4: diff against the browser view =="
echo "Open result.html next to the browser's rendered results; agreement"
echo "at the row level is the definition of a verified contract."
echo "Remember: one request every 2-3 s; cache immutable results; do not"
echo "redistribute party personal data (report Chapter 8)."
