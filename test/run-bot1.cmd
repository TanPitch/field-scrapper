@echo off
rem Run bot 1 (daily LED scrape of due provinces) from Task Scheduler.
rem DATABASE_URL points at the canonical NAS DB; the run is logged so a
rem scheduled pass that misbehaves can be read after the fact.
rem scrapeDay --dry is what decide-lists due provinces; the real pass skips
rem anything whose night:<date>:<code> run_key already finished clean.
cd /d "D:\Projects\field-scrapper\test"
set "DATABASE_URL=postgres://postgres:landmap@192.168.1.137:33200/landmap"
rem SCRAPEDAY_ARGS=--dry lets you test this wrapper without scraping;
rem leave it unset in the scheduled task and it runs the real pass.
"C:\Users\tanya\.bun\bin\bun.exe" scrapeDay.js %SCRAPEDAY_ARGS% >> "D:\Projects\field-scrapper\test\out\bot1-schedule.log" 2>&1
