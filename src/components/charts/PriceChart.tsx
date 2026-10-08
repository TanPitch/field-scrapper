import { Chart, type ChartConfiguration } from 'chart.js';
import { useEffect, useRef } from 'react';
import { ACCENT } from '../../data/constants';
import { fdate, dfmtShort } from '../../lib/format';
import { fmtMoneyNow } from '../../hooks/useMoney';
import { getApp, patchApp, toast, useApp } from '../../store/useApp';
import type { ChartTick, Parcel } from '../../types';
import { evFlagPlugin, setupCharts } from './chartSetup';

const DAY = 864e5;
type Pt = { x: number; y: number };
type RangeOpts = { min?: number; max?: number };

/** Marker interval in months; 'year' means every 12. */
const TICK_MONTHS: Record<Exclude<ChartTick, 'none'>, number> = { year: 12, m6: 6, m4: 4, m3: 3 };
const TH_MONTH_ABBR = ['à¸¡.à¸„.', 'à¸.à¸ž.', 'à¸¡à¸µ.à¸„.', 'à¹€à¸¡.à¸¢.', 'à¸ž.à¸„.', 'à¸¡à¸´.à¸¢.', 'à¸.à¸„.', 'à¸ª.à¸„.', 'à¸.à¸¢.', 'à¸•.à¸„.', 'à¸ž.à¸¢.', 'à¸˜.à¸„.'];

/**
 * Evenly spaced month markers anchored at January of the first year in view, so a
 * fixed interval (every 3/4/6 months or yearly) stays on calendar boundaries
 * instead of drifting by month length.
 */
export function tickValues(min: number, max: number, tick: ChartTick): number[] {
  if (tick === 'none') return [];
  const step = TICK_MONTHS[tick];
  const d0 = new Date(min), d1 = new Date(max);
  const out: number[] = [];
  let y = d0.getFullYear(), m = 0;
  for (let guard = 0; guard < 400; guard++) {
    const t = new Date(y, m, 1).getTime();
    if (t > max) break;
    if (t >= min) out.push(t);
    m += step;
    while (m >= 12) { m -= 12; y++; }
  }
  if (out.length > 12) return [];
  void d1;
  return out;
}

/** Marker label: yearly shows the full year, otherwise a short "ก.ย. 69". */
export function tickLabel(ts: number, tick: ChartTick): string {
  const d = new Date(ts);
  if (tick === 'year') return String(d.getFullYear() + 543);
  return `${TH_MONTH_ABBR[d.getMonth()]} ${String(d.getFullYear() + 543).slice(-2)}`;
}

/** Apply the shared chart range (and auto-fit the y axis to the visible window). */
export function applyChartRange(ch: Chart<'line', Pt[]>, p: Parcel): void {
  const f0 = p.hist[0].d, f1 = p.hist[p.hist.length - 1].d;
  const r = getApp().chartRange;
  let min = r?.min ?? f0, max = r?.max ?? f1;
  min = Math.max(f0, Math.min(min, f1));
  max = Math.max(min + DAY, Math.min(max, f1));
  const vis = p.hist.filter(h => h.d >= min && h.d <= max);
  const ys = (vis.length ? vis : p.hist).map(h => h.v);
  const ymin = Math.min(...ys), ymax = Math.max(...ys);
  const pad = (ymax - ymin) * 0.15 || Math.max(1, ymax * 0.08);
  const sx = ch.options.scales?.x as RangeOpts | undefined;
  const sy = ch.options.scales?.y as RangeOpts | undefined;
  if (sx) { sx.min = min; sx.max = max; }
  if (sy) { sy.min = ymin - pad; sy.max = ymax + pad; }
  ch.update('none');
}

/** The chart keeps Chart.js auto ticks; month markers live on the range slider. */



/** Price-history line chart: wheel = zoom, mouse drag = pan, dblclick = reset. */
export function PriceChart({ parcel: p }: { parcel: Parcel }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const chart = useRef<Chart<'line', Pt[]> | null>(null);
  const range = useApp(s => s.chartRange);
    useApp(s => s.priceBath); /* re-render the tooltip formatter's source of truth */

  useEffect(() => {
    const canvas = cv.current;
    if (!canvas) return;
    setupCharts();
    const f0 = p.hist[0].d, f1 = p.hist[p.hist.length - 1].d;
    const evs = p.events.map(e => ({ ...e, d: p.hist[e.idx].d }));
    const thai = { family: "'Noto Sans Thai',sans-serif" };
    const tick = { color: '#666D62', font: { family: 'Noto Sans Thai', size: 9 } };
    const cfg: ChartConfiguration<'line', Pt[]> = {
      type: 'line',
      data: {
        datasets: [{
          data: p.hist.map(h => ({ x: h.d, y: h.v })),
          borderColor: ACCENT, borderWidth: 2, pointRadius: 4, pointBackgroundColor: '#fff', pointBorderColor: ACCENT,
          pointHoverRadius: 6, pointHitRadius: 14, tension: 0.3,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
        events: ['mousemove', 'mouseout', 'click', 'touchstart', 'touchmove'],
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0B0D0B', borderColor: '#333A31', borderWidth: 1, titleColor: '#8F968C', bodyColor: '#F1F3EE',
            displayColors: false, padding: 8,
            titleFont: { ...thai, weight: 600, size: 11 }, bodyFont: { ...thai, size: 11 },
            callbacks: { title: it => fdate(it[0].parsed.x as number), label: it => fmtMoneyNow(it.parsed.y as number) },
          },
        },
        scales: {
          x: { type: 'linear', ticks: { ...tick, maxTicksLimit: 5, callback: v => dfmtShort.format(Number(v)) }, grid: { color: 'rgba(255,255,255,.05)' } },
          y: { ticks: { ...tick, maxTicksLimit: 4, callback: v => (Number(v) >= 1e6 ? (Number(v) / 1e6).toFixed(1) + 'M' : Math.round(Number(v) / 1000) + 'K') }, grid: { color: 'rgba(255,255,255,.05)' } },
        },
      },
      plugins: [evFlagPlugin(evs)],
    };
    const ch = new Chart<'line', Pt[]>(canvas, cfg);
    chart.current = ch;
    applyChartRange(ch, p);
    
    const cur = () => getApp().chartRange ?? { min: f0, max: f1 };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const sc = ch.scales.x, r = canvas.getBoundingClientRect();
      const px = Math.min(Math.max(e.clientX - r.left, sc.left), sc.right);
      const t = sc.getValueForPixel(px) ?? 0;
      const c = cur(), f = e.deltaY < 0 ? 0.8 : 1.25;
      let nmin = t - (t - c.min) * f, nmax = t + (c.max - t) * f;
      const span = DAY * 5;
      if (nmax - nmin < span) { const m = (nmin + nmax) / 2; nmin = m - span / 2; nmax = m + span / 2; }
      patchApp({ chartRange: { min: Math.max(f0, nmin), max: Math.min(f1, nmax) } });
    };
    let dr: { x: number; c: { min: number; max: number } } | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      dr = { x: e.clientX, c: { ...cur() } };
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
    };
    const onMove = (e: PointerEvent) => {
      if (!dr) return;
      const sc = ch.scales.x, r = canvas.getBoundingClientRect();
      const px1 = Math.min(Math.max(dr.x - r.left, sc.left), sc.right);
      const px2 = Math.min(Math.max(e.clientX - r.left, sc.left), sc.right);
      const dt = (sc.getValueForPixel(px1) ?? 0) - (sc.getValueForPixel(px2) ?? 0);
      const span = dr.c.max - dr.c.min, full = f1 - f0;
      let nmin = dr.c.min + dt, nmax = dr.c.max + dt;
      if (span >= full) { nmin = f0; nmax = f1; }
      else {
        if (nmin < f0) { nmax += f0 - nmin; nmin = f0; }
        if (nmax > f1) { nmin -= nmax - f1; nmax = f1; }
      }
      patchApp({ chartRange: { min: nmin, max: nmax } });
    };
    const onUp = () => { dr = null; canvas.style.cursor = 'grab'; };
    const onDbl = () => { patchApp({ chartRange: null }); toast('à¸”à¸¹à¸Šà¹ˆà¸§à¸‡à¹€à¸§à¸¥à¸²à¸—à¸±à¹‰à¸‡à¸«à¸¡à¸”'); };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('dblclick', onDbl);
    return () => {
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('dblclick', onDbl);
      ch.destroy();
      chart.current = null;
    };
  }, [p]);

  useEffect(() => { if (chart.current) applyChartRange(chart.current, p); }, [range, p]);

  return <canvas ref={cv} className="cursor-grab touch-pan-y" />;
}
