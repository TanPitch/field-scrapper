/* useSettingsSync.ts — keep user settings and annotations in Postgres.
 *
 *   import { useSettingsSync } from '../hooks/useSettingsSync';
 *
 * Two directions, and the asymmetry between them is deliberate:
 *
 *   IN  — on sign-in, pull the user's prefs, table layout and named layers and
 *         apply them over whatever localStorage holds. Local wins on conflict
 *         for now, because losing a setting someone just made is worse than
 *         overwriting an older one; once this has proven itself the precedence
 *         should flip to server-wins.
 *   OUT — every change is written back, coalesced and serialised, so a colour
 *         picker dragging through twelve shades produces one PUT carrying the
 *         shade the user actually stopped on, not twelve racing.
 *
 * Offline is a normal state, not an error. If the API is unreachable the store
 * keeps working from localStorage and the write is dropped — the alternative is
 * an app that stops letting you rearrange your table because a server restarted.
 */

import { useEffect, useRef } from 'react';
import { api, makeWriter } from '../lib/api';
import { useAnnotations } from '../store/useAnnotations';
import { patchApp, useApp } from '../store/useApp';

/* One writer per sink. Debounced so a burst of changes collapses. */
const writePrefs = makeWriter(600);
const writeLayers = makeWriter(900);
const writeColumns = makeWriter(900);

interface ApiUser {
  id: number; username: string; displayName: string | null;
  avatarColor: string | null; avatarPath: string | null; isAdmin: boolean;
}

/** Scalar app preferences worth keeping server-side. */
const SYNCED_PREFS = [
  'theme', 'accentColor', 'glassLevel', 'layout', 'basemap', 'restrict', 'override',
  'statusVisible', 'popColors', 'reColor', 'popupCfg', 'lbCfg', 'popupMode',
  'showLandKindIcon', 'priceBath', 'priceSpace', 'chartTick', 'markerSize',
  'labelSold', 'labelOverlap', 'showCircleMeta', 'areaTagsOn', 'drawDistMode',
  'reduceMotion', 'highlightSoldRounds', 'chartForecast', 'detailRowHidden', 'detailRowOrder', 'filters', 'sort',
] as const;

export interface SyncState {
  /** Set once the initial pull has completed, successfully or not. */
  ready: boolean;
  /** Non-null when the last write to the server failed. */
  error: string | null;
}

export function useSettingsSync(): SyncState {
  const readyRef = useRef(false);
  const errRef = useRef<string | null>(null);
  const signedIn = useApp(s => s.signedIn);
  const role = useApp(s => s.role);
  const userName = useApp(s => s.userName);

  /* IN: pull on sign-in. */
  useEffect(() => {
    if (!signedIn) { readyRef.current = false; return; }
    let live = true;

    void (async () => {
      const me = await api.get<{ user: ApiUser }>('/api/me');
      if (!live) return;

      if (me.ok && me.data?.user) {
        const u = me.data.user;
        if (u.displayName) patchApp({ userName: u.displayName });
        void loadPrefs();
        void loadColumns();
        void loadLayers();
      } else if (me.error) {
        /* 401 is the expected answer for a local-only account; anything else is
           worth surfacing because it means the sync is not happening. */
        errRef.current = me.error;
      }
      readyRef.current = true;
    })();

    return () => { live = false; };
  }, [signedIn, role, userName]);

  /* OUT: prefs. Subscribing to the whole state object is fine here — it is a
     single immer-free store and the writer debounces. */
  useEffect(() => {
    if (!signedIn) return;
    return useApp.subscribe((s) => {
      const prefs: Record<string, unknown> = {};
      for (const k of SYNCED_PREFS) {
        if (k in s) prefs[k] = (s as unknown as Record<string, unknown>)[k];
      }
      if (!Object.keys(prefs).length) return;
      writePrefs('prefs', async () => {
        const r = await api.put('/api/me/prefs', { prefs });
        if (!r.ok) errRef.current = r.error;
      });
    });
  }, [signedIn]);

  /* OUT: annotations (table columns, drawings, areas, parcels). */
  useEffect(() => {
    if (!signedIn) return;
    let first = true;
    return useAnnotations.subscribe((s) => {
      /* Skip the very first notification: it fires on subscribe with the state
         we just loaded, and writing it straight back would be a pointless PUT
         that could also clobber a newer server value with a stale local one. */
      if (first) { first = false; return; }

      for (const [layerId, a] of Object.entries(s.layers)) {
        writeLayers(`layer:${layerId}`, async () => {
          if (!a.name && !a.note && !Object.keys(a.style ?? {}).length
            && !Object.keys(a.nameStyle ?? {}).length && !Object.keys(a.noteStyle ?? {}).length) {
            await api.del(`/api/me/layers/${encodeURIComponent(layerId)}`);
            return;
          }
          const kind = layerId.startsWith('area-') ? 'display_area'
            : layerId.startsWith('parcel-') ? 'parcel' : 'drawing';
          const r = await api.put(`/api/me/layers/${encodeURIComponent(layerId)}`, {
            kind, name: a.name ?? null, note: a.note ?? null,
            style: a.style ?? {},
            /* Per-field styles ride alongside; the server keeps them in the same
               jsonb so one row carries the whole annotation. */
            nameStyle: a.nameStyle ?? {}, noteStyle: a.noteStyle ?? {},
          });
          if (!r.ok) errRef.current = r.error;
        });
      }
    });
  }, [signedIn]);

  /* OUT: table column layout. */
  useEffect(() => {
    if (!signedIn) return;
    let first = true;
    return useAnnotations.subscribe((s) => {
      if (first) { first = false; return; }
      for (const [tableKey, cols] of Object.entries(s.cols)) {
        writeColumns(`cols:${tableKey}`, async () => {
          const r = await api.put(`/api/me/tables/${encodeURIComponent(tableKey)}`, {
            columns: Object.entries(cols).map(([key, c], i) => ({
              key, label: c.name ?? null, note: c.note ?? null, style: c.style ?? {},
              visible: true, pinned: false, order: i,
            })),
          });
          if (!r.ok) errRef.current = r.error;
        });
      }
    });
  }, [signedIn]);

  return { ready: readyRef.current, error: errRef.current };
}

/* ------------------------------------------------------------------ loads */

async function loadPrefs(): Promise<void> {
  const r = await api.get<{ prefs: Record<string, unknown> }>('/api/me/prefs');
  if (!r.ok || !r.data?.prefs) return;
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r.data.prefs)) if (k in SYNCED_PREFS) patch[k] = v;
  if (Object.keys(patch).length) patchApp(patch as never);
}

async function loadColumns(): Promise<void> {
  const r = await api.get<{ columns: Array<Record<string, unknown>> }>('/api/me/tables/lots');
  if (!r.ok || !r.data?.columns?.length) return;
  const cols: Record<string, { name?: string | null; note?: string | null; style?: object }> = {};
  for (const c of r.data.columns) {
    const key = String(c.key);
    cols[key] = { name: (c.label as string) ?? null, note: (c.note as string) ?? null, style: (c.style as object) ?? {} };
  }
  useAnnotations.getState().setColumn('lots', '__bulk__', null);
  for (const [k, v] of Object.entries(cols)) useAnnotations.getState().setColumn('lots', k, v);
}

async function loadLayers(): Promise<void> {
  const r = await api.get<{ layers: Array<Record<string, unknown>> }>('/api/me/layers');
  if (!r.ok || !r.data?.layers?.length) return;
  for (const l of r.data.layers) {
    useAnnotations.getState().setLayer(String(l.id), {
      name: (l.name as string) ?? null,
      note: (l.note as string) ?? null,
      style: (l.style as object) ?? {},
    });
  }
}
