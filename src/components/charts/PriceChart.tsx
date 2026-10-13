import { Chart, type ChartConfiguration } from 'chart.js';
import { useEffect, useRef } from 'react';
import { ACCENT } from '../../data/constants';
import { fdate, dfmtShort } from '../../lib/format';
import { fmtMoneyNow } from '../../hooks/useMoney';
import { getApp, patchApp, toast, useApp } from '../../store/useApp';
import type { ChartTick, Parcel } from '../../types';
import { evFlagPlugin, setupCharts, todayLinePlugin } from './chartSetup';
import { nextRoundPrice } from '../../lib/price';

/** ACCENT at reduced opacity, for the forecast leg. Canvas cannot use
 *  color-mix, so hex is expanded here. */
function fade(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

const DAY = 864e5;
type Pt = { x: number; y: number };
type RangeOpts = { min?: number; max?: number };

/** Marker interval in months; 'year' means every 12. */
const TICK_MONTHS: Record<Exclude<ChartTick, 'none'>, number> = { year: 12, m6: 6, m4: 4, m3: 3 };
const TH_MONTH_ABBR = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'สิ.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

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
    const priceBath = useApp(s => s.priceBath); /* re-render the tooltip formatter's source of truth */
  const showToday = useApp(s => s.chartTodayLine);
  /* Component scope, not effect scope: the chart is rebuilt by this effect, and
     a toggle that only re-reads inside the effect body would leave the already
     drawn canvas untouched until the parcel changed. */
  const showFc = useApp(s => s.chartForecast);

  useEffect(() => {
    const canvas = cv.current;
    if (!canvas) return;
    setupCharts();
    /* Only what has actually happened is plotted. p.hist carries a point per
       round including scheduled ones still ahead, and drawing those connected
       up to today implies a trend that has not happened. Knowing the next round
       date is useful for the price headline; it is not evidence about the past. */
    const now = Date.now();
    const past = p.hist.filter(h => h.d <= now);
    /* A single point cannot draw a line. Fall back to the full history so the
       chart still shows something rather than an empty box. */
    const plot = past.length >= 2 ? past : p.hist;

    /* The next round's price is computable — the discount ladder is public
       arithmetic, not a guess — so it belongs on the chart. It is drawn as a
       dashed, half-strength tail rather than a solid point, because it has not
       happened: a solid marker would read as a result the same way the old
       future points did. The break in styling is what separates "sold" from
       "will be". */
    const next = showFc ? nextRoundPrice(p, now) : null;
    const lastReal = plot[plot.length - 1];
    const fc = next && lastReal && next.date > lastReal.d ? { d: next.date, v: next.price } : null;
    const pts = fc ? [...plot, fc] : plot;
    /* Index of the final real point: any segment ending after it is forecast. */
    const realEnd = plot.length - 1;

    const f0 = plot[0].d, f1 = fc ? fc.d : plot[plot.length - 1].d;
    const evs = p.events
      .map(e => ({ ...e, d: p.hist[e.idx]?.d }))
      .filter(e => e.d != null && e.d <= now);
    const thai = { family: "'Noto Sans Thai',sans-serif" };
    const tick = { color: '#666D62', font: { family: 'Noto Sans Thai', size: 9 } };
    const cfg: ChartConfiguration<'line', Pt[]> = {
      type: 'line',
      data: {
        datasets: [{
          data: pts.map(h => ({ x: h.d, y: h.v })),
          borderColor: ACCENT, borderWidth: 2, pointRadius: 4,
          pointHoverRadius: 6, pointHitRadius: 14,
          /* Per-segment styling. p1DataIndex is the *later* endpoint of the
             segment, so `> realEnd` picks out exactly the one forecast leg and
             leaves every historical leg solid. */
          segment: {
            borderDash: c => (c.p1DataIndex > realEnd ? [5, 4] : undefined),
            borderColor: c => (c.p1DataIndex > realEnd ? fade(ACCENT, 0.45) : ACCENT),
            borderWidth: c => (c.p1DataIndex > realEnd ? 1.5 : 2),
          },
          /* The forecast point is hollow, so it reads as "not yet" on its own
             even if the dashes are lost at a glance. */
          pointBackgroundColor: c => (c.dataIndex > realEnd ? 'transparent' : '#fff'),
          pointBorderColor: c => (c.dataIndex > realEnd ? fade(ACCENT, 0.45) : ACCENT),
          pointStyle: c => (c.dataIndex > realEnd ? 'circle' : 'circle'),
          /* Sharp corners. tension 0.3 curved between points, which smoothed a
             discrete auction ladder into a shape the data never took — and a
             dip that never happened would look like a real one. */
          tension: 0,
          cubicInterpolationMode: 'default',
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
      plugins: [
        evFlagPlugin(evs),
        /* Vertical line at today, so "how stale is this" is readable at a glance.
           Toggleable in settings — it is useful for a live lot and clutter on a
           closed one. */
        ...(showToday ? [todayLinePlugin(now)] : []),
      ],
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
    /* showToday and priceBath must be deps: toggling either in settings re-renders
       this component, but the Chart instance is only rebuilt by this effect. Leaving
       them out meant the toggle appeared to do nothing until the parcel changed. */
  }, [p, showToday, showFc, priceBath]);

  useEffect(() => { if (chart.current) applyChartRange(chart.current, p); }, [range, p]);

  return <canvas ref={cv} className="cursor-grab touch-pan-y" />;
}
