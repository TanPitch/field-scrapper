@echo off
rem Field Scrapper dev flow on this PC - DB lives on the TrueNAS (fs-db :33200).
rem Opens two windows: the API on :8787 and the Vite dev server on :5173.
rem Frontend: http://localhost:5173 (Vite proxies /api and /img to :8787).
set "DATABASE_URL=postgres://postgres:landmap@192.168.1.137:33200/landmap"
cd /d "%~dp0"
start "Field Scrapper API :8787" cmd /k bun server/index.js
start "Field Scrapper web :5173" cmd /k bun run dev
echo Started: http://localhost:5173 with the NAS database on fs-db :33200.
