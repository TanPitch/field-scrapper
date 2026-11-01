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
import { DEFAULT_COL_ORDER } from '../data/constants';
import { normStyle, type RichTextStyle } from '../lib/richText';
import { useAnnotations } from '../store/useAnnotations';
import { patchApp, useApp } from '../store/useApp';
import type { ColKey } from '../types';

/* One writer per sink. Debounced so a burst of changes collapses. */
const writePrefs = makeWriter(600);
const writeLayers = makeWriter(900);
const writeColumns = makeWriter(900);

interface ApiUser {
  id: number; username: string; displayName: string | null;
  avatarColor: string | null; avatarPath: string | null; isAdmin: boolean;
}

/** Scalar app preferences worth keeping server-side. Every user-settable value
 *  is on this list — anything deliberately chosen should follow the account.
 *  pinnedIds counts too, but it is a Set, so the writer serialises it to an
 *  array and the loader turns it back. */
const SYNCED_PREFS = [
  'theme', 'accentColor', 'glassLevel', 'layoutMode', 'basemap', 'restrict', 'override',
  'statusVisible', 'popColors', 'reColor', 'popupCfg', 'lbCfg', 'popupMode',
  'showLandKindIcon', 'priceBath', 'priceSpace', 'chartTick', 'markerSize',
  'labelSold', 'labelNextDate', 'labelOverlap', 'showCircleMeta', 'areaTagsOn', 'drawDistMode',
  'reduceMotion', 'highlightSoldRounds', 'chartForecast', 'chartForecastSolid', 'chartTodayLine',
  'condoUnitOrder', 'persistMapView', 'lastView', 'sectionsCollapsed', 'autoDeselect',
  'detailRowHidden', 'detailRowOrder', 'soldPriceHeadline', 'hidePrevSaleRounds', 'roundGroupLabels', 'roundsPreview', 'roundsGroupBorder', 'filters', 'sort',
  'overlays', 'flood', 'landOn', 'cctvOn', 'sensOn', 'transportOn', 'transportOpacity', 'sensOpacity',
  'searchLimit', 'logLimit', 'bottomH', 'forceArea', 'cascade', 'gkey',
  'avatarColor', 'avatarCfg', 'twoFa', 'pinnedIds', 'ringColor',
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
        if (!(k in s)) continue;
        /* Sets are not JSON — pinned rows go out as an array of ids. */
        prefs[k] = k === 'pinnedIds'
          ? Array.from(s.pinnedIds as ReadonlySet<number>)
          : (s as unknown as Record<string, unknown>)[k];
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

  /* OUT: table column layout.
   *
   * Reorder, hide, pin and resize are useApp state, not annotation rows;
   * watching only the annotations (as the first version did) meant a layout
   * the user spent an afternoon arranging never left the machine unless they
   * also happened to rename a column. Both stores feed the same writer, and
   * the 900 ms debounce collapses a drag-resize into one PUT. */
  useEffect(() => {
    if (!signedIn) return;
    let annFirst = true;
    const fire = () => writeColumns('cols:lots', putColumns);
    const unA = useAnnotations.subscribe(() => { if (annFirst) { annFirst = false; return; } fire(); });
    const unApp = useApp.subscribe(fire);
    return () => { unA(); unApp(); };
  }, [signedIn]);

  return { ready: readyRef.current, error: errRef.current };
}

/* ------------------------------------------------------------------ loads */

async function loadPrefs(): Promise<void> {
  const r = await api.get<{ prefs: Record<string, unknown> }>('/api/me/prefs');
  if (!r.ok || !r.data?.prefs) return;
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r.data.prefs)) {
    if (!(k in SYNCED_PREFS)) continue;
    /* pinnedIds went out as an array (Sets are not JSON). */
    patch[k] = k === 'pinnedIds' && Array.isArray(v)
      ? new Set<number>(v as number[])
      : v;
  }
  if (Object.keys(patch).length) patchApp(patch as never);
}

async function loadColumns(): Promise<void> {
  const r = await api.get<{ columns: Array<Record<string, unknown>> }>('/api/me/tables/lots');
  if (!r.ok || !r.data?.columns?.length) return;
  const cols: Record<string, {
    name?: string | null; note?: string | null;
    style?: RichTextStyle; nameStyle?: RichTextStyle; noteStyle?: RichTextStyle;
  }> = {};
  for (const c of r.data.columns) {
    const key = String(c.key);
    /* Same lift as loadLayers: the per-field styles live inside the stored
       style jsonb and normStyle would strip them if left nested. */
    const raw = (c.style ?? {}) as Record<string, unknown>;
    cols[key] = {
      name: (c.label as string) ?? null, note: (c.note as string) ?? null,
      style: normStyle(raw),
      nameStyle: normStyle(raw.nameStyle), noteStyle: normStyle(raw.noteStyle),
    };
  }
  useAnnotations.getState().setColumn('lots', '__bulk__', null);
  for (const [k, v] of Object.entries(cols)) useAnnotations.getState().setColumn('lots', k, v);

  /* The other half of the restore: visible, pinned, order and width ride on
     the same rows as the labels. Skipping them here was why a layout saved on
     one machine came back as if it had never been arranged — the PUT stored
     everything, the GET rebuilt only names and styles. Server rows win where
     they exist; columns the server has not recorded keep their local state. */
  const known = new Set<ColKey>(DEFAULT_COL_ORDER);
  const app = useApp.getState();
  const savedOrder = r.data.columns.map((c) => String(c.key)).filter((k) => known.has(k as ColKey));
  const at = new Set(savedOrder);
  const hidden = new Set(app.colHidden);
  const pinned = new Set(app.colPinned);
  const widths = { ...app.colWidths };
  for (const c of r.data.columns) {
    const key = c.key as ColKey;
    if (!known.has(key)) continue;
    if (c.visible === false) hidden.add(key); else hidden.delete(key);
    if (c.pinned === true) pinned.add(key); else pinned.delete(key);
    if (typeof c.width === 'number' && c.width > 0) widths[key] = c.width;
    else delete widths[key];
  }
  patchApp({
    colOrder: [...(savedOrder as ColKey[]), ...app.colOrder.filter((k) => !at.has(String(k)))].filter(
      (k, i, all) => all.indexOf(k) === i),
    colHidden: hidden,
    colPinned: pinned,
    colWidths: widths,
  });
}

/* The layout side of the column sync. One row per column of the current
 * layout — the full set, not just annotated columns — so the restore side can
 * rebuild the whole table instead of whatever subset a rename had touched. */
async function putColumns(): Promise<void> {
  const app = useApp.getState();
  const cols = useAnnotations.getState().cols['lots'] ?? {};
  const r = await api.put('/api/me/tables/lots', {
    columns: app.colOrder.map((key, order) => ({
      key,
      label: cols[key]?.name ?? null,
      note: cols[key]?.note ?? null,
      style: cols[key]?.style ?? {},
      /* Per-field styles ride alongside; see styleWith() in server/users.js,
         which keeps all three in one jsonb. */
      nameStyle: cols[key]?.nameStyle ?? {},
      noteStyle: cols[key]?.noteStyle ?? {},
      visible: !app.colHidden.has(key),
      pinned: app.colPinned.has(key),
      width: app.colWidths[key] ?? null,
      order,
    })),
  });
  /* A module-level write: no errRef in scope, and a failed settings write is a
     logged warning, not a UI event — offline is a normal state here. */
  if (!r.ok) console.warn('[settings-sync] columns PUT failed:', r.error);
}

async function loadLayers(): Promise<void> {
  const r = await api.get<{ layers: Array<Record<string, unknown>> }>('/api/me/layers');
  if (!r.ok || !r.data?.layers?.length) return;
  for (const l of r.data.layers) {
    /* styleToCss only knows the flat keys, and normStyle (applied by setLayer)
       strips anything else - so the per-field styles have to be lifted out of
       the stored jsonb here or a nameStyle saved on another machine comes back
       as nothing. See styleWith() in server/users.js. */
    const raw = (l.style ?? {}) as Record<string, unknown>;
    useAnnotations.getState().setLayer(String(l.id), {
      name: (l.name as string) ?? null,
      note: (l.note as string) ?? null,
      style: normStyle(raw),
      nameStyle: normStyle(raw.nameStyle),
      noteStyle: normStyle(raw.noteStyle),
    });
  }
}
