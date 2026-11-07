@echo off
rem Whole-Thailand backfill (Phase 5): scrape + ingest one province at a time.
rem Started from Task Scheduler (FieldScrapper-Backfill-TH). The console may
rem look quiet - progress lines are few by design; watch
rem   test\out\backfill.log        and the manifest test\out\backfill-manifest.json
rem Do NOT close this window mid-run: it kills the current province pass.
rem The ingest side recovers on the next run (manifest records what landed).
title FieldScrapper backfill - do not close
cd /d "D:\Projects\field-scrapper\test"
set "DATABASE_URL=postgres://postgres:landmap@192.168.1.137:33200/landmap"
"C:\Users\tanya\.bun\bin\bun.exe" backfillProvinces.js --all >> "D:\Projects\field-scrapper\test\out\backfill.log" 2>&1
echo == backfill pass ended %date% %time% %errorlevel% >> "D:\Projects\field-scrapper\test\out\backfill.log"
