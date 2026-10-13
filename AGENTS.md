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
DATABASE_URL=postgres://postgres:landmap@localhost:5433/landmap
```

Postgres runs in Docker as `landmap-pg`, port `5433`.

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