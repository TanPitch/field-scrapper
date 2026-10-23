# Working notes for this repo

## Branch policy

**Push to `dev`. Do not push to `main`.**

`main` is reserved for released versions. Every change, fix and experiment goes
to `dev` until the user explicitly says a new version is being cut. Only push
to `main` when asked — not because the work "looks finished".

```bash
git checkout -b <name>      # or stay on dev
git push -u origin dev
```

## Running things

```bash
bun run dev                 # frontend
bun server/index.js         # API on :8787
DATABASE_URL=postgres://postgres:landmap@192.168.1.137:33200/landmap
```

Postgres runs locally in Docker as `landmap-pg`, port `5433` — dev fallback for
small tests only. Since 2026-10-23 the canonical DB and images live on the NAS
(see the Docker section below); code stays local until the app itself runs
there.

Do not start long-running servers from a tool/agent shell. `Start-Process` with
inherited stdout has hung the tool. The user runs the frontend and API in their
own terminals.

Vite proxies `/api` and `/img` to the API server, so the browser only ever
talks to :5173.

## Editing files

Use the **Edit tool** for source changes. Do not do line-index arithmetic in
PowerShell over source files.

This is not a style preference. Line-array surgery silently produces garbage
when an index lookup misses: a `-1` slice re-emits the whole file, a `$out[0..-1]`
inserts nothing, and the write succeeds regardless. This corrupted
`DetailView.tsx` and `panes.tsx` on the same evening. `tsc` catches syntax
damage but not a block moved to the wrong function.

After any structural edit:

```bash
bun run typecheck   # must be 0
bun run build       # must be 0
cd test && bun test # 47 pass
```

`tsc` passing is not proof an edit landed correctly — a duplicated JSX block
typechecks fine. For structural changes, also confirm the feature appears in
the app, or assert on the anchor: e.g. each of `<VPad>`, `<DetRows>`,
`<PriceChart>` should appear exactly once.

## Testing

Frontend behaviour is only provable in a browser. Changes to rendering,
selection, popups and canvas drawing should be confirmed by the user before
being called done.

## Seeding

`bun test/seedUsers.js` creates `admin / admin1234` and
`fieldscrapper / user1234`. These are local development credentials only.

## Docs layout

`docs/` holds `RELEASE_NOTES.md`, `BOT-PLAN.md` and `KNOWLEDGE.md`. `ROADMAP.md`,
`README.md` and this file stay at the root. `AUDIT.md` is untracked user work —
never sweep it into a commit.

Thai text through tool shells: piping bun stdout in PowerShell mangles it.
Capture with `cmd /c "bun ... > file"` and read the file back with
`-Encoding utf8`.

## Hand DOL batches (how city work actually moves)

The user reads กรมที่ดิน's web UI (unlimited — no scripted quota) and sends back
a list shaped `deed : 0-R-N.N [lat,lon] ตำบล`. Verify each row against LED
**before** recording: sizes live in `auction_lots` (`size_rai/ngan/wa`), not on
`parcels`. Then:

```bash
bun recordDolPoint.js <parcelId> <lat> <lon> <r> <n> <wa> "<note>"
```

The script refuses a hand point whose size disagrees with LED. Omitting the
size skips the check — the note carries the DOL size and the reason; that is
the escape path for rows where LED's own row turns out to be wrong (rare:
88022 first read 0-0-9 vs LED 0-0-0.90, but the re-read gave 0-0-0.9 matching
LED — the flag was a decimal misread, not bad LED data). น.ส.3ก. deeds
(4265, 4266 in ขอนแก่น) are absent from TD, DOL and the NS3K layer — parked
on purpose, `geo_note` explains.

## Docker server (DB + images live there, 2026-10-23)

TrueNAS + Portainer on the LAN: `https://192.168.1.137:33100/`, user
`opencode-portainer`. Always `curl.exe -k` (self-signed). Portainer API:
`POST /api/auth {"Username":…,"Password":…}` → `{jwt}`, then
`Authorization: Bearer <jwt>`; the docker proxy sits under
`/api/endpoints/3/docker/...`. Two quirks learned the hard way:

- a fresh JWT is only accepted immediately after issuing — re-auth inside every
  shell block and call without pausing first;
- container-create can return an empty body while succeeding — re-POST and the
  conflict message leaks the full id.

What is running: container **`fs-db`** (postgis/postgis:16-3.4, host port
**33200**, restart unless-stopped).

`DATABASE_URL` for scripts that should use the server DB (the local
`landmap-pg` on :5433 stays as fallback until the app itself runs on Docker):

```
DATABASE_URL=postgres://postgres:landmap@192.168.1.137:33200/landmap
```

NAS paths:

- postgres data → `/mnt/disk-01/App_Storage/field-scrapper/db/pgdata`
- pg_dump `-Fc` safety copy → `/mnt/disk-01/App_Storage/field-scrapper/db/restore/landmap.dump`
- auction images (7,046 files, 1.63 GB) → `/mnt/disk-01/App_Storage/field-scrapper/data`

Verified on 2026-10-23: row counts identical to local (parcels 5,698 /
auction_lots 5,839 / auction_rounds 46,712 / lot_images 5,140 / parcels with
geom 5,349 / dol match 176 / crs_calibration 2), PostGIS 3.4.3, images complete
(count 7,046 exactly — the first tar pass silently skipped 8 files; shipped as
a repair tar). The restore was done by running `pg_restore` in a one-shot
container against the live server — the postgres entrypoint runs its script dir
as uid 70 and `/data` is root-owned, so the init-time `10-restore.sh` redirect
fails (`Permission denied`) and nothing restores; if fs-db is ever re-initialised
from scratch, chown `/data` first or restore by hand the same way.

Keep local copies of both until the app itself runs on Docker — the local
frontend still serves `/img/land` from `test/data/img`.

## App pack (image + stack ready 2026-10-23, not deployed)

`server/index.js` serves `dist/` when it exists (SPA fallback included), so the
same server file runs in dev and in the container. Packing pieces:

- `server/Dockerfile` — two-stage `oven/bun:1`; the build stage runs
  `bun run build`, so `docs/*.md` must stay in the context (AboutPane inlines
  `docs/RELEASE_NOTES.md?raw`).
- `.dockerignore` — prunes node_modules / dist / out / .git / test/data /
  test/research / test/out / AUDIT.md.
- `docker/portainer-stack.yml` — service `fs-app`, **8788→8787**, `DATABASE_URL`
  through fs-db's host port, `IMAGE_ROOT=/app/data` bind-mounted from the NAS
  image share.
- Deploy route that keeps code off the NAS: build on the PC
  (`docker build -f server/Dockerfile -t fieldscrapper:latest .`),
  `docker save` → copy → `docker load` on the NAS, then deploy the stack yml in
  Portainer.
- `run-dev.cmd` (repo root) opens the dev pair (API :8787 + Vite :5173) already
  pointed at the NAS DB.