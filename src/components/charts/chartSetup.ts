import {
  Chart, Filler, LineController, LineElement, LinearScale, PointElement, CategoryScale, Tooltip, type Plugin,
} from 'chart.js';

let done = false;
/** Register only the Chart.js pieces we use (tree-shakeable) — idempotent. */
export function setupCharts(): void {
  if (done) return;
  done = true;
  Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Filler);
  Chart.defaults.font.family = "'Noto Sans Thai',sans-serif";
  Chart.defaults.interaction.mode = 'nearest';
  Chart.defaults.interaction.intersect = false;
}

export interface EventFlag { d: number; label: string; color: string; ink: string }

/**
 * Vertical line at "today".
 *
 * The price history stops at the present, so without this there is no cue for
 * where the present is: the last plotted point can be months old and looks
 * equally current. Drawn solid and dimmer than the event flags so it reads as a
 * reference line, not as another event.
 */
export function todayLinePlugin(now: number): Plugin<'line'> {
    return {
        id: 'todayline',
        afterDatasetsDraw(chart) {
            const { ctx, chartArea } = chart;
            if (!chartArea) return;
            const px = chart.scales.x.getPixelForValue(now);
            /* Off-chart when the user has panned into the past. */
            if (px < chartArea.left || px > chartArea.right) return;

            ctx.save();
            ctx.strokeStyle = 'rgba(255,255,255,.20)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(px, chartArea.top);
            ctx.lineTo(px, chartArea.bottom);
            ctx.stroke();

            const label = 'วันนี้';
            ctx.font = "10px 'Noto Sans Thai',sans-serif";
            const w = ctx.measureText(label).width + 10;
            const h = 13;
            const x0 = Math.min(Math.max(px - w / 2, chartArea.left), chartArea.right - w);
            const y0 = chartArea.top;
            ctx.fillStyle = 'rgba(0,0,0,.5)';
            ctx.fillRect(x0, y0, w, h);
            ctx.fillStyle = 'rgba(255,255,255,.7)';
            ctx.fillText(label, x0 + 5, y0 + 9.5);
            ctx.restore();
        },
    };
}

function pill(
  ctx: CanvasRenderingContext2D, text: string, x: number, y: number,
  bg: string, ink: string, arrow: 'left' | 'right',
): void {
  ctx.font = "600 9px 'Noto Sans Thai'";
  const w = ctx.measureText(text).width + 14;
  const x0 = arrow === 'right' ? x - w : x;
  ctx.fillStyle = bg;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x0, y, w, 13, 3); else ctx.rect(x0, y, w, 13);
  ctx.fill();
  /* sharp arrow tip pointing off-graph, so the user knows which way to scroll */
  const tipX = arrow === 'right' ? x + 5 : x0 - 5;
  ctx.beginPath();
  ctx.moveTo(arrow === 'right' ? x0 + w : x0, y);
  ctx.lineTo(tipX, y + 6.5);
  ctx.lineTo(arrow === 'right' ? x0 + w : x0, y + 13);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = ink;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x0 + 7, y + 7);
}

/**
 * Dashed vertical flags + pill labels for in-view price events. Events outside the
 * visible window get pinned to the corresponding edge with an outward arrow, so a
 * zoomed view still shows that ประกาศขาย / นำกลับมาขายใหม่ exists and on which side.
 */
export function evFlagPlugin(evs: EventFlag[]): Plugin<'line'> {
  return {
    id: 'evflags',
    afterDatasetsDraw(chart) {
      const { ctx, chartArea } = chart;
      const x = chart.scales.x;
      if (!evs.length || !chartArea) return;
      ctx.save();
      const off: { ev: EventFlag; side: 'left' | 'right' }[] = [];
      evs.forEach(ev => {
        /* Anchor to where the dot is actually drawn.
           chart.getPixelForValue() interpolates within the scale's tick
           spacing, so for a date that is not itself a tick it returns a pixel
           slightly off the data point — enough for the dashes to visibly miss
           the dot, which is what this flag was doing. The dataset meta holds
           the exact pixel Chart.js used for each rendered point, so snapping to
           the nearest one guarantees the line and the dot share an x. */
        const meta: any = (chart as any).getDatasetMeta?.(0);
        const pts: { x: number }[] = meta?.data ?? [];
        let px = x.getPixelForValue(ev.d);
        if (pts.length) {
          let best = Infinity;
          for (const p of pts) {
            const d = Math.abs(p.x - px);
            if (d < best) { best = d; px = p.x; }
          }
        }
        if (px < chartArea.left || px > chartArea.right) {
          off.push({ ev, side: px < chartArea.left ? 'left' : 'right' });
          return;
        }
        ctx.strokeStyle = ev.color; ctx.setLineDash([3, 3]); ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(px, chartArea.top + 15); ctx.lineTo(px, chartArea.bottom); ctx.stroke();
        ctx.setLineDash([]);
        const w = ctx.measureText(ev.label).width + 14;
        const x0 = Math.min(Math.max(px - w / 2, chartArea.left), chartArea.right - w);
        ctx.fillStyle = ev.color;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x0, chartArea.top, w, 13, 3); else ctx.rect(x0, chartArea.top, w, 13);
        ctx.fill();
        ctx.fillStyle = ev.ink; ctx.textBaseline = 'middle';
        ctx.fillText(ev.label, x0 + 7, chartArea.top + 7);
      });
      /* stack off-graph pills under the in-view ones so nothing overlaps */
      off.forEach(({ ev, side }, i) => {
        const y = chartArea.top + 15 + i * 16;
        if (y + 13 > chartArea.bottom) return;
        /* pin to the edge the event actually sits beyond, arrow pointing that way */
        if (side === 'left') pill(ctx, `${ev.label} ↩`, chartArea.left + 2, y, ev.color, ev.ink, 'left');
        else pill(ctx, `↪ ${ev.label}`, chartArea.right - 2, y, ev.color, ev.ink, 'right');
      });
      ctx.restore();
    },
  };
}
