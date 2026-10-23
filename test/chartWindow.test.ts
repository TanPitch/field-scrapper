import { test, expect } from 'bun:test';
import { chartWindow } from '../src/components/charts/PriceChart';

const DAY = 864e5;
const T = Date.UTC(2026, 0, 1);
const d = (n: number) => T + n * DAY;

/* The today line is drawn at getPixelForValue(now) against whatever the x scale
   happens to be. When the scale was set after the chart had already drawn, the
   first frame used Chart.js's own "nice" bounds and the line landed in the wrong
   place until a range change forced the correction. These pin the arithmetic that
   both the first paint and every repaint now share.

   With no saved range the axis now auto-fits: half the data span padding on
   each side (minimum one month), so the announce-price dot is not glued to the
   axis edge. Half-span ≈ 100 days for history d(0)–d(100), 65 days when the
   forecast extends to d(130). */

test('with no saved range the window pads the data on both sides', () => {
  expect(chartWindow(d(0), d(100), null, null)).toEqual({ min: d(-50), max: d(150) });
});

test('a forecast round extends the window past the last real point', () => {
  // The chart draws a dashed tail for the next round. An axis that stopped at the
  // last real point cut off exactly where the forecast began.
  const w = chartWindow(d(0), d(100), d(130), null);
  expect(w.max).toBe(d(195));
});

test('a forecast inside the data does not shrink the window', () => {
  const w = chartWindow(d(0), d(100), d(40), null);
  expect(w.max).toBe(d(150));
});

test('a single-point lot gets a month of air on each side', () => {
  const w = chartWindow(d(50), d(50), null, null);
  expect(w).toEqual({ min: d(20), max: d(80) });
});

test('a saved range inside the data is respected', () => {
  expect(chartWindow(d(0), d(100), null, { min: d(20), max: d(60) }))
    .toEqual({ min: d(20), max: d(60) });
});

test('a range left over from another lot is clamped, not trusted', () => {
  // The shared range persists across parcels. Parcel A zoomed to 2024; opening
  // parcel B whose history starts in 2020 must not put the axis before its data.
  const w = chartWindow(d(0), d(100), null, { min: d(400), max: d(500) });
  expect(w.min).toBe(d(100));   // clamped to the end of this lot's data
  expect(w.max).toBeGreaterThanOrEqual(w.min);
});

test('the window is never zero width', () => {
  const w = chartWindow(d(50), d(50), null, { min: d(50), max: d(50) });
  expect(w.max).toBeGreaterThan(w.min);
});

test('a single-point lot still gets an axis', () => {
  const w = chartWindow(d(50), d(50), null, null);
  expect(Number.isFinite(w.min)).toBe(true);
  expect(Number.isFinite(w.max)).toBe(true);
  expect(w.max).toBeGreaterThan(w.min);
});

test('min never exceeds max whatever it is handed', () => {
  // An inverted range would make the axis refuse to draw at all.
  for (const r of [{ min: d(80), max: d(20) }, { min: d(100), max: d(100) }, null]) {
    const w = chartWindow(d(0), d(100), null, r);
    expect(w.max).toBeGreaterThanOrEqual(w.min);
  }
});
