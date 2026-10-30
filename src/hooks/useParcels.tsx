import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { computeRows, dataPass, emptyReason, type RowInputs, type RowSets } from '../lib/visibility';
import { ALL_PARCELS, loadParcels, PARCEL_BY_ID, subscribeParcels, getDataOrigin, type DataSourceKind } from '../data/liveData';
import { framePoints, getMap } from '../map/mapRef';
import { deselect } from '../store/actions';
import { useApp } from '../store/useApp';

export interface ParcelsValue extends RowSets {
  emptyWhy: string;
  /** Where the rows on screen came from, so the UI can say so out loud. */
  origin: DataSourceKind;
  /** Non-null when the API could not be reached and fixtures are standing in. */
  loadError: string | null;
  loading: boolean;
}

const ParcelsContext = createContext<ParcelsValue | null>(null);

/**
 * Single source of truth for "which parcels are visible / in the table".
 * Replaces the old imperative applyVisible() pipeline: it is a pure memo over store state.
 *
 * This is also where the real data arrives. fetchParcels() replaces the seeded
 * fixtures with what the scrapers collected, and `version` is what forces the
 * memo to recompute afterwards — without it the first (fixture) computation would
 * be cached and the real rows would never appear, which is exactly the bug that
 * made the app look empty.
 */
export function ParcelsProvider({ children, provinceCode }: { children: ReactNode; provinceCode?: number }) {
  const filters = useApp(s => s.filters);
  const statusVisible = useApp(s => s.statusVisible);
  const pinnedIds = useApp(s => s.pinnedIds);
  const restrict = useApp(s => s.restrict);
  const override = useApp(s => s.override);
  const areas = useApp(s => s.areas);
  const forceArea = useApp(s => s.forceArea);
  const bounds = useApp(s => s.bounds);
  const zoom = useApp(s => s.zoom);
  const mapReady = useApp(s => s.mapReady);
  const sort = useApp(s => s.sort);

  const [version, setVersion] = useState(0);
  const [origin, setOrigin] = useState<DataSourceKind>(getDataOrigin);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => subscribeParcels(() => setVersion((v) => v + 1)), []);

  /* A selection the current view no longer contains lets itself go. Hide a
     status, tighten a filter or type into the search box, and the parcel left
     open in the right panel used to stay open — visible on the panel yet
     unreachable from map and table, with its selection ring stranded. A
     re-published collection can also drop the selected id outright (a lot the
     server corrected out). Both cases clear the selection here: deselect() is
     exactly the dismissal the popup-X button performs. Runs on `version` too,
     because PARCEL_BY_ID is what the new data replaced. */
  useEffect(() => {
    const sel = useApp.getState().selectedId;
    if (sel == null) return;
    const parcel = PARCEL_BY_ID.get(sel);
    if (!parcel) { deselect(); return; }
    if (!dataPass(parcel, { filters, statusVisible })) deselect();
  }, [filters, statusVisible, version]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    void loadParcels(provinceCode).then((r) => {
      if (!live) return;
      setOrigin(r.kind);
      setLoadError(r.error);
      setLoading(false);

      /* Frame whatever just arrived.
       *
       * Without this the app sits on DEFAULT_CENTER (Bangkok) while the data is
       * in Khon Kaen, ~2.2 degrees west and 3 south. Because the visibility
       * pipeline filters to the viewport, every parcel is excluded from the map
       * source — so the table says "30 parcels", the banner says "loaded", and
       * the map has zero markers and nothing to click.
       *
       * Only when the current view contains nothing. Once the user has panned
       * somewhere deliberately we must not yank the camera back. */
      if (r.kind !== 'api' || !r.count) return;
      const b = getMap()?.getBounds();
      const pts: Array<[number, number]> = ALL_PARCELS.map((p) => [p.lng, p.lat] as [number, number]);
      const anyVisible = b && pts.some(([lng, lat]) => b.contains([lng, lat]));
      if (!anyVisible) framePoints(pts);
    });
    return () => { live = false; };
  }, [provinceCode]);

  /* `version` is in the dependency list but never read: it is the signal that
     the parcel collection was replaced wholesale, which computeRows() cannot
     see because it reads the module directly. Reading it here keeps the lint
     honest about why the memo has to re-run. */
  const value = useMemo<ParcelsValue>(() => {
    const inputs: RowInputs = { filters, statusVisible, pinnedIds, restrict, override, areas, forceArea, bounds, zoom, mapReady, sort };
    if (version < 0) throw new Error('unreachable — version is a dependency signal only');
    return { ...computeRows(inputs), emptyWhy: emptyReason(inputs), origin, loadError, loading };
  }, [filters, statusVisible, pinnedIds, restrict, override, areas, forceArea,
      bounds, zoom, mapReady, sort, version, origin, loadError, loading]);

  return <ParcelsContext.Provider value={value}>{children}</ParcelsContext.Provider>;
}

export function useParcels(): ParcelsValue {
  const v = useContext(ParcelsContext);
  if (!v) throw new Error('useParcels must be used inside <ParcelsProvider>');
  return v;
}

/**
 * Re-fetch, e.g. from the refresh button on the data-source banner.
 * No local state needed: loadParcels() notifies subscribers on completion, and
 * the provider's subscription is what bumps the memo.
 */
export function useRefreshParcels(): () => void {
  return useCallback(() => { void loadParcels(); }, []);
}
