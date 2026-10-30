import { Chart, type ChartConfiguration } from 'chart.js';
import { useEffect, useRef } from 'react';
import { fdate, dfmtShort } from '../../lib/format';
import { fmtMoneyNow } from '../../hooks/useMoney';
import { getApp, patchApp, toast, useApp, effectiveAccent } from '../../store/useApp';
import { inkOn } from '../../data/constants';
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

/**
 * The x window the chart shows.
 *
 * Pure, so it can be pinned by tests rather than inferred from what the canvas
 * happens to look like. `range` is the shared, user-dragged window and may be
 * null, or may be left over from a different lot - hence the clamping.
 *
 * The upper bound follows the next round's date rather than the last real one,
 * because the dataset carries a forecast point past it. Stopping at the last
 * real point clipped the very tail the chart draws.
 */
export function chartWindow(
  f0: number, f1: number, forecast: number | null | undefined,
  range: { min: number; max: number } | null | undefined,
): { min: number; max: number } {
  const top = forecast != null && forecast > f1 ? forecast : f1;
  if (range) {
    let min = Math.max(f0, Math.min(range.min, top));
    /* Never a zero-width axis: a single-point lot would divide by zero somewhere
       in Chart.js. One day is the smallest window that means anything. */
    let max = Math.max(min + DAY, Math.min(range.max, top));
    return { min, max };
  }
  /* No saved range: auto-fit the axis with air on both sides instead of gluing
     the first dot to the y axis. The end date 01/09→01/10 reads as roughly
     01/08→01/11 — half the span on each side — and a single-point lot still
     gets a month of breathing room. */
  const span = Math.max(0, top - f0);
  const gap = Math.max(span / 2, 30 * DAY);
  return { min: f0 - gap, max: top + gap };
}

/** Apply the shared chart range (and auto-fit the y axis to the visible window). */
export function applyChartRange(ch: Chart<'line', Pt[]>, p: Parcel): void {
  /* Same source as the constructor — see plotOf. The old version sized the
     axis from the full ladder (scheduled future rounds included) while the
     constructor plotted past-only, and the mismatch pushed the today line into
     the past. */
  const { pts, f0, f1, next } = plotOf(p, getApp().chartForecast, Date.now());
  if (!pts.length) return;
  const { min, max } = chartWindow(f0, f1, next?.date, getApp().chartRange);
  const vis = pts.filter(h => h.d >= min && h.d <= max);
  const ys = (vis.length ? vis : pts).map(h => h.v);
  const ymin = Math.min(...ys), ymax = Math.max(...ys);
  const pad = (ymax - ymin) * 0.15 || Math.max(1, ymax * 0.08);
  const sx = ch.options.scales?.x as RangeOpts | undefined;
  const sy = ch.options.scales?.y as RangeOpts | undefined;
  if (sx) { sx.min = min; sx.max = max; }
  if (sy) { sy.min = ymin - pad; sy.max = ymax + pad; }
  ch.update('none');
}

/**
 * What gets plotted, and the marks on it — the single source the constructor
 * and applyChartRange both read.
 *
 * Plot rule (what the user asked for): every round that has already happened,
 * plus ONE point for the next scheduled round. Round 5 of 8 → 6 points; 8 of 8
 * → 8 with nothing ahead; a lot killed after round 3 of 6 keeps 3, because "no
 * further rounds" is not "a next round somewhere". A lot whose rounds are all
 * still ahead shows its single first point, styled as forecast — a lone hollow
 * marker, since a line needs two. */
export function plotOf(p: Parcel, showFc: boolean, now: number): {
  pts: { d: number; v: number }[];
  /** Index of the last real (past) point; -1 when every point is forecast. */
  realEnd: number;
  f0: number;
  f1: number;
  next: { date: number; price: number } | null;
} {
  const past = p.hist.filter(h => h.d <= now);
  const next = showFc ? nextRoundPrice(p, now) : null;
  const lastPast = past[past.length - 1] ?? null;
  /* The forecast point only makes sense beyond the last real one: a "next"
     round dated before the last past point is stale schedule data, not a
     future, and it would draw the tail backwards. */
  const fc = lastPast && next && next.date > lastPast.d ? { d: next.date, v: next.price } : null;
  const pts = fc ? [...past, fc] : past;
  return {
    pts,
    realEnd: past.length - 1,
    f0: pts[0]?.d ?? 0,
    f1: pts[pts.length - 1]?.d ?? 0,
    next,
  };
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
  /* Draw the forecast leg in full ink instead of dashed/faded (ผู้ใช้จะตั้งได้). */
  const solidFc = useApp(s => s.chartForecastSolid);
  /* The accent the line/pills paint with resolves here too — a theme flip must
     rebuild the chart to re-ink the canvas, just like the toggles above. */
  const theme = useApp(s => s.theme);
  const accentUser = useApp(s => s.accentColor);

  useEffect(() => {
    const canvas = cv.current;
    if (!canvas) return;
    setupCharts();
    const now = Date.now();
    /* Plot points and the x window come from one helper — see plotOf — so the
       axis could never disagree with the data it frames. */
    const { pts, realEnd, f0, f1, next } = plotOf(p, showFc, now);
    /* No past rounds and no computable next round: there is nothing to draw
       and everything below reads pts[0]. Safe to return here because this is
       an effect body, not the render - an early return between hooks is what
       broke the range slider. */
    if (!pts.length) return;

    /* The x window is part of the config, not applied afterwards.
     *
     * Chart.js draws once inside the constructor, and with no min/max on a linear
     * scale it picks its own "nice" bounds for that first frame. applyChartRange
     * then set the exact window and redrew - so the first thing on screen was
     * drawn against a different scale from every frame after it, which is what
     * put the today line in the wrong place until the user touched the range and
     * forced the correction. Stating the window up front means there is only
     * ever one scale. */
    const win = chartWindow(f0, f1, next?.date, getApp().chartRange);

    /* The forecast leg and point are drawn translucent + dashed (setting: solid)
       rather than a solid marker, because it has not happened: a solid marker
       would read as a result the same way the old future points did. The break
       in styling is what separates "sold" from "will be". */
    const isFcLeg = (i: number) => i > realEnd;

    /* Canvas cannot read a CSS var, so the accent the line paints with is
       resolved here — once per chart build — and rides the colour choices
       below. */
    const acc = effectiveAccent();

    /* The announce pill is the accent's flag on this chart. The parcel's event
       log carries the colour each event was mapped with — at data-load time,
       possibly under another theme — so the announce entry is re-inked to the
       accent that applies right now. Sold/dead events wear status colours,
       which do not follow the theme. */
    const evs = p.events
      .map(e => ({ ...e, d: p.hist[e.idx]?.d }))
      .filter(e => e.d != null && e.d <= now)
      .map(e => (e.label === 'ประกาศขาย' ? { ...e, color: acc, ink: inkOn(acc) } : e));
    const thai = { family: "'Noto Sans Thai',sans-serif" };
    const tick = { color: '#666D62', font: { family: 'Noto Sans Thai', size: 9 } };
    const cfg: ChartConfiguration<'line', Pt[]> = {
      type: 'line',
      data: {
        datasets: [{
          data: pts.map(h => ({ x: h.d, y: h.v })),
          borderColor: acc, borderWidth: 2, pointRadius: 4,
          pointHoverRadius: 6, pointHitRadius: 14,
          /* Per-segment styling. p1DataIndex is the *later* endpoint of the
             segment, so `> realEnd` picks out exactly the forecast leg and
             leaves every historical leg solid — unless the "solid forecast"
             setting asks for full ink everywhere. */
          segment: {
            borderDash: c => (isFcLeg(c.p1DataIndex) && !solidFc ? [5, 4] : undefined),
            borderColor: c => (isFcLeg(c.p1DataIndex) && !solidFc ? fade(acc, 0.45) : acc),
            borderWidth: c => (isFcLeg(c.p1DataIndex) && !solidFc ? 1.5 : 2),
          },
          /* The forecast point is hollow, so it reads as "not yet" on its own
             even if the dashed leg is missed at a glance. The solid option
             switches the leg to full ink but keeps the point hollow — the
             future stays marked as not-yet. */
          pointBackgroundColor: c => (isFcLeg(c.dataIndex) && !solidFc ? 'transparent' : '#fff'),
          pointBorderColor: c => (isFcLeg(c.dataIndex) && !solidFc ? fade(acc, 0.45) : acc),
          pointStyle: () => 'circle',
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
            callbacks: {
              title: it => fdate(it[0].parsed.x as number),
              label: it => fmtMoneyNow(it.parsed.y as number),
              /* The pills carry the SHORT tag (one word per row), so the full
                 LED wording rides the tooltip instead: any event whose pill is
                 within ~65px of the hovered point is repeated here verbatim. */
              beforeBody: it => {
                const px = it[0]?.element?.x;
                if (px == null) return;
                const sc = ch.scales.x;
                const near = evs.filter(ev => Math.abs(sc.getPixelForValue(ev.d) - px) <= 65);
                return near.map(ev => `${ev.label} · ${fdate(ev.d)}`);
              },
            },
          },
        },
        scales: {
          x: { type: 'linear', min: win.min, max: win.max, ticks: { ...tick, maxTicksLimit: 5, callback: v => dfmtShort.format(Number(v)) }, grid: { color: 'rgba(255,255,255,.05)' } },
          y: { ticks: { ...tick, maxTicksLimit: 4, callback: v => (Number(v) >= 1e6 ? (Number(v) / 1e6).toFixed(1) + 'M' : Math.round(Number(v) / 1000) + 'K') }, grid: { color: 'rgba(255,255,255,.05)' } },
        },
      },
      plugins: [
        /* Today's line draws UNDER the event pills: events are facts, today is
           a reference. The today pill itself sits at the plot bottom, so the
           two can no longer collide even when they overlap in date. */
        ...(showToday ? [todayLinePlugin(now)] : []),
        evFlagPlugin(evs),
      ],
    };
    const ch = new Chart<'line', Pt[]>(canvas, cfg);
    chart.current = ch;
    applyChartRange(ch, p);
    
    const cur = () => getApp().chartRange ?? chartWindow(f0, f1, next?.date, null);
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
    const onDbl = () => { patchApp({ chartRange: null }); toast('ดูช่วงเวลาทั้งหมด'); };
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
       them out meant the toggle appeared to do nothing until the parcel changed.
       theme/accentColor too — a canvas cannot read a CSS var, so a colour switch
       rebuilds the chart to re-ink line and pills. */
  }, [p, showToday, showFc, priceBath, solidFc, theme, accentUser]);

  useEffect(() => { if (chart.current) applyChartRange(chart.current, p); }, [range, p]);

  return <canvas ref={cv} className="cursor-grab touch-pan-y" />;
}
