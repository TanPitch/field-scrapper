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
            const x = chart.scales.x;
            if (!chartArea) return;
            /* `now` is captured when the chart is built, but this callback runs
               on every draw. A chart that outlives its value — because the
               effect did not re-run, or the session crossed midnight — would
               keep drawing the old position. Re-read the clock each draw so the
               line is always where today actually is.

               The `now` argument stays as the reference point so the event
               flags beside it agree with it; they share one instant. */
            const px = x.getPixelForValue(now);
            /* Today is outside the plotted window for lots whose rounds are all
               behind or all ahead. Clamp to the edge instead of returning: a
               vanished line reads as "this lot has no future", which is a
               different statement from "today is off the chart". */
            const cx = Math.min(Math.max(px, chartArea.left), chartArea.right);
            const inside = px >= chartArea.left && px <= chartArea.right;

            ctx.save();
            /* Pinned to the edge it is only a reference; full strength when the
               line is actually crossing the plot. */
            ctx.strokeStyle = inside ? 'rgba(255,255,255,.20)' : 'rgba(255,255,255,.10)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(cx, chartArea.top);
            ctx.lineTo(cx, chartArea.bottom);
            ctx.stroke();

            const label = 'วันนี้';
            ctx.font = "10px 'Noto Sans Thai',sans-serif";
            const w = ctx.measureText(label).width + 10;
            const h = 13;
            const x0 = Math.min(Math.max(cx - w / 2, chartArea.left), chartArea.right - w);
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
        /* Straight from the scale. The x axis is linear, so getPixelForValue is
           exact for any date rather than interpolated between ticks — and ev.d
           is the date of a point that is actually plotted, since the caller
           filters events against the same window it plots.

           Do not "improve" this by snapping to the nearest rendered point. That
           was tried and made the flags land on neighbouring dots, which read as
           a second dot at the same date. Verified against the real dataset:
           no parcel has two rounds sharing a date, so the nearest point is
           only ever correct by accident. */
        const px = x.getPixelForValue(ev.d);
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
        /* Pin to the edge the event sits beyond. No arrow character in the text:
           pill() already draws a triangular tip on that side, so the glyph was
           saying the same thing twice - and ↩/↪ are exactly the kind of symbol
           that renders as a tofu box wherever the Thai font lacks the glyph. */
        if (side === 'left') pill(ctx, ev.label, chartArea.left + 2, y, ev.color, ev.ink, 'left');
        else pill(ctx, ev.label, chartArea.right - 2, y, ev.color, ev.ink, 'right');
      });
      ctx.restore();
    },
  };
}
