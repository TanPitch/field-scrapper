import { useCallback } from 'react';
import { formatMoney, formatShortMoney } from '../lib/format';
import { getApp, useApp } from '../store/useApp';

/** Settings-aware money formatter for components (re-renders when ฿ / spacing prefs change). */
export function useMoney(): (v: number) => string {
  const bath = useApp(s => s.priceBath);
  const space = useApp(s => s.priceSpace);
  return useCallback((v: number) => formatMoney(v, { bath, space }), [bath, space]);
}

/** Same formatting for imperative code (map popups, labels). */
export const fmtMoneyNow = (v: number | null): string => {
  /* Price per ตร.ว. over a lot with no land area is absent, not zero. */
  if (v == null) return '—';
  const { priceBath, priceSpace } = getApp();
  return formatMoney(v, { bath: priceBath, space: priceSpace });
};
export const fmtShortMoneyNow = (v: number): string => formatShortMoney(v, getApp().priceBath);
