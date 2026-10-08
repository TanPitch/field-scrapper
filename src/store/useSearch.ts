import { create } from 'zustand';
import type { BBox, LngLat } from '../types';

export interface OnlinePlace { name: string; lat: number; lng: number; src: string; cat: string }
export interface OnlineState { status: 'idle' | 'loading' | 'done' | 'error'; list: OnlinePlace[] }

interface SearchState {
  /** Text last searched (drives the "search again" button). */
  query: string;
  lastFullBBox: BBox | null;
  online: OnlineState;
  onlineStale: boolean;
  dropOpen: boolean;
  patch: (p: Partial<Omit<SearchState, 'patch'>>) => void;
}

export const useSearch = create<SearchState>(set => ({
  query: '',
  lastFullBBox: null,
  online: { status: 'idle', list: [] },
  onlineStale: false,
  dropOpen: false,
  patch: p => set(p),
}));

export const centerInside = (box: BBox | null, c: LngLat): boolean =>
  !box || (c[0] >= box[0] && c[0] <= box[2] && c[1] >= box[1] && c[1] <= box[3]);
