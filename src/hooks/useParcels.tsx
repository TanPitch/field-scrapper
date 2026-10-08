import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { computeRows, emptyReason, type RowInputs, type RowSets } from '../lib/visibility';
import { useApp } from '../store/useApp';

interface ParcelsValue extends RowSets { emptyWhy: string }
const ParcelsContext = createContext<ParcelsValue | null>(null);

/**
 * Single source of truth for "which parcels are visible / in the table".
 * Replaces the old imperative applyVisible() pipeline: it is a pure memo over store state.
 */
export function ParcelsProvider({ children }: { children: ReactNode }) {
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

  const value = useMemo<ParcelsValue>(() => {
    const inputs: RowInputs = { filters, statusVisible, pinnedIds, restrict, override, areas, forceArea, bounds, zoom, mapReady, sort };
    return { ...computeRows(inputs), emptyWhy: emptyReason(inputs) };
  }, [filters, statusVisible, pinnedIds, restrict, override, areas, forceArea, bounds, zoom, mapReady, sort]);

  return <ParcelsContext.Provider value={value}>{children}</ParcelsContext.Provider>;
}

export function useParcels(): ParcelsValue {
  const v = useContext(ParcelsContext);
  if (!v) throw new Error('useParcels must be used inside <ParcelsProvider>');
  return v;
}
