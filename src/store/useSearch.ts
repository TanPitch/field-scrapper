import { create } from 'zustand';
import type { BBox, LngLat } from '../types';

export interface OnlinePlace { name: string; lat: number; lng: number; src: string; cat: string }
export interface OnlineState { status: 'idle' | 'loading' | 'done' | 'error'; list: OnlinePlace[] }

/** A search hit as shown in the right panel / plotted as a map pin. */
export interface SearchRow {
  id: string;
  kind: 'land' | 'cctv' | 'sensor' | 'place' | 'transport';
  name: string;
  sub: string;
  lng: number;
  lat: number;
  dot?: string;
  parcelId?: number;
  place?: OnlinePlace;
}

interface SearchState {
  /** Text last searched (drives the "search again" button). */
  query: string;
  lastFullBBox: BBox | null;
  online: OnlineState;
  onlineStale: boolean;
  dropOpen: boolean;
  /** Resolved hits for the current query — shared with the right panel. */
  rows: SearchRow[];
  /** Set by SearchBox so the panel can navigate to a result. */
  onPick: ((rid: string) => void) | null;
  /** Set by SearchBox: re-runs its current text against the current bbox. */
  rerun: (() => void) | null;
  patch: (p: Partial<Omit<SearchState, 'patch'>>) => void;
}

export const useSearch = create<SearchState>(set => ({
  query: '',
  lastFullBBox: null,
  online: { status: 'idle', list: [] },
  onlineStale: false,
  dropOpen: false,
  rows: [],
  onPick: null,
  rerun: null,
  patch: p => set(p),
}));

export const centerInside = (box: BBox | null, c: LngLat): boolean =>
  !box || (c[0] >= box[0] && c[0] <= box[2] && c[1] >= box[1] && c[1] <= box[3]);