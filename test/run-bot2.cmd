@echo off
rem Run bot 2 (TD then DOL resolve) from Task Scheduler.
rem DATABASE_URL points at the canonical NAS DB; the run is logged so a
rem scheduled pass that misbehaves can be read after the fact.
cd /d "D:\Projects\field-scrapper\test"
set "DATABASE_URL=postgres://postgres:landmap@192.168.1.137:33200/landmap"
"C:\Users\tanya\.bun\bin\bun.exe" resolveCoordsCLI.js >> "D:\Projects\field-scrapper\test\out\bot2-schedule.log" 2>&1
