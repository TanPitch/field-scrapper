import { getApp } from '../store/useApp';
import type { Parcel } from '../types';

/** A parcel counts as "นำกลับมาขายใหม่" (resale) while it is still on sale. */
export const isResell = (p: Parcel): boolean => p.resell && p.status === 'sale';

/** Dot / marker colour (table, search results, map circle). */
export function parcelDot(p: Parcel): string {
  const s = getApp();
  return isResell(p) ? s.reColor : s.popColors[p.status];
}

/** Popup background colour. */
export function parcelPopupBg(p: Parcel): string {
  const s = getApp();
  if (p.status === 'normal') return '#0D0F0D';
  return isResell(p) ? s.reColor : s.popColors[p.status];
}