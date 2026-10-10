import { getApp } from '../store/useApp';
import type { Parcel } from '../types';

/** A parcel counts as "นำกลับมาขายใหม่" (resale) while it is still on sale. */
export const isResell = (p: Parcel): boolean => p.resell && p.status === 'sale';

/** Dot / marker colour (table, search results, map circle). */
export function parcelDot(p: Parcel): string {
  const s = getApp();
  return isResell(p) ? s.popColors.re : s.popColors[p.status];
}

/**
 * Popup background colour — same source as the dot, so changing a status colour
 * in settings repaints the dot and both popup layouts at once.
 */
export function parcelPopupBg(p: Parcel): string {
  return parcelDot(p);
}