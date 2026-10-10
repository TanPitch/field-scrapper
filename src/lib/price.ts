import type { Parcel } from '../types';

/**
 * Change between the latest price and the one before it (the previous round's
 * opening price). Returns null when there is not enough history to compare.
 */
export interface PriceDelta { pct: number; up: boolean }

export function lastDelta(p: Parcel): PriceDelta | null {
  const h = p.hist;
  if (h.length < 2) return null;
  const prev = h[h.length - 2].v;
  const cur = h[h.length - 1].v;
  if (!prev) return null;
  const pct = ((cur - prev) / prev) * 100;
  if (!Number.isFinite(pct)) return null;
  /* Drop anything that would display as "+0%" / "-0%" — callers hide the whole
     bottom strip in that case, so an empty delta must never reach them. */
  const rounded = Math.round(pct);
  if (rounded === 0) return null;
  return { pct: rounded, up: pct > 0 };
}

/** "-5%" / "+3%" — always signed, no decimals. */
export const deltaText = (d: PriceDelta): string => `${d.up ? '+' : ''}${d.pct}%`;