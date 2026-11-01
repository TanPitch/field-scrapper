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
            /* Bottom of the plot, not the top: the top strip is where the price
               events sit (one stacked row each), and the วันนี้ pill used to
               paint straight over them when today crossed a marked date. */
            const y0 = chartArea.bottom - h;
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
 * Dashed vertical flags + pill labels for price events. One placement pass for
 * every event — in-view and edge-pinned alike — with greedy row stacking, so
 * two events landing near each other (a relist announced days after the first
 * sale expired) paint side by side in rows instead of over each other. Events
 * outside the visible window get pinned to the corresponding edge with an
 * outward arrow. The full word still reaches the user on hover — the price
 * tooltip repeats the whole label for any event near the cursor.
 */
export function evFlagPlugin(evs: EventFlag[]): Plugin<'line'> {
  return {
    id: 'evflags',
    afterDatasetsDraw(chart) {
      const { ctx, chartArea } = chart;
      const x = chart.scales.x;
      if (!evs.length || !chartArea) return;
      ctx.save();
      ctx.font = PILL_FONT;

      /* Desired geometry: pill width from the SHORT label (the tag is what is
         drawn), x from the scale. Straight from the scale — the x axis is
         linear, so getPixelForValue is exact for any date rather than
         interpolated between ticks — and ev.d is the date of a point that is
         actually plotted, since the caller filters events against the same
         window it plots.

         Do not "improve" this by snapping to the nearest rendered point. That
         was tried and made the flags land on neighbouring dots, which read as
         a second dot at the same date. Verified against the real dataset:
         no parcel has two rounds sharing a date, so the nearest point is
         only ever correct by accident. */
      type Want = {
        ev: EventFlag; short: string; w: number;
        x0: number; px: number; pinned: 'left' | 'right' | null;
      };
      const want: Want[] = evs.map((ev) => {
        const short = shortLabel(ev.label);
        const w = ctx.measureText(short).width + 14;
        const px = x.getPixelForValue(ev.d);
        const inside = px >= chartArea.left && px <= chartArea.right;
        if (inside) {
          return {
            ev, short, w, px, pinned: null,
            x0: Math.min(Math.max(px - w / 2, chartArea.left), chartArea.right - w),
          };
        }
        return {
          ev, short, w, px, pinned: px < chartArea.left ? 'left' : 'right',
          x0: px < chartArea.left ? chartArea.left + 2 : chartArea.right - w - 2,
        };
      });

      /* Row assignment happens before anything draws, so a pill never paints
         over one that already claimed the spot. The pills live in the band the
         chart reserves BELOW the x-axis labels (layout.padding.bottom=60 in
         PriceChart): three rows stride 16px from just under the tick text, so
         a tag stack never covers dots, grid or axis labels — the วันนี้ pill
         alone keeps its seat inside the plot bottom. The band is a hard cap:
         out of room means skipped, not drawn over the axis or canvas edge.
         The 1px x-overlap rule is unchanged — two rounds a day apart deserve
         visible separation wherever in the band they landed. */
      const ROW_H = 16;
      const BAND_TOP = 14;
      const BAND_ROWS = 3;
      type Placed = { x0: number; w: number; row: number };
      const placed: Placed[] = [];
      const fits = (cand: Want, row: number): boolean =>
        placed.every((p) =>
          p.row !== row
          /* 1px of air: two rounds a day apart deserve visible separation. */
          || cand.x0 + cand.w + 1 < p.x0
          || p.x0 + p.w + 1 < cand.x0,
        );

      /* Dashed date lines first, full plot height — the pills then sit on top
         of them, and a date stays traceable even where a pill is skipped. */
      want.forEach(wp => {
        if (wp.pinned) return;
        ctx.strokeStyle = wp.ev.color; ctx.setLineDash([3, 3]); ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(wp.px, chartArea.top); ctx.lineTo(wp.px, chartArea.bottom); ctx.stroke();
        ctx.setLineDash([]);
      });

      want.forEach(wp => {
        let row = 0;
        while (row < BAND_ROWS && !fits(wp, row)) row++;
        if (row >= BAND_ROWS) return;
        placed.push({ x0: wp.x0, w: wp.w, row });
        const y = chartArea.bottom + BAND_TOP + row * ROW_H;
        if (wp.pinned) {
          /* Pin to the edge the event sits beyond. No arrow character in the
             text: pill() already draws a triangular tip on that side, so the
             glyph was saying the same thing twice - and ↩/↪ are exactly the
             kind of symbol that renders as a tofu box wherever the Thai font
             lacks the glyph. */
          pill(ctx, wp.short, wp.pinned === 'left' ? chartArea.left + 2 : chartArea.right - 2, y, wp.ev.color, wp.ev.ink, wp.pinned);
        } else {
          ctx.fillStyle = wp.ev.color;
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(wp.x0, y, wp.w, 13, 3); else ctx.rect(wp.x0, y, wp.w, 13);
          ctx.fill();
          ctx.fillStyle = wp.ev.ink; ctx.textBaseline = 'middle';
          ctx.fillText(wp.short, wp.x0 + 7, y + 7);
        }
      });
      ctx.restore();
    },
  };
}

/** Pill font the event tags are measured AND drawn with. Stated once so a
 *  different plugin order cannot change pill width between measure and draw. */
const PILL_FONT = "600 9px 'Noto Sans Thai'";

/* Longest prefix first — นำกลับมาขายใหม่ must be matched before a tail rule
 * could clip it to nonsense. Each entry reads the LED word as the tag LED's
 * own pages print: the pills are tags, the tooltip carries the full sentence. */
const SHORT_PREFIXES: [string, string][] = [
  ['นำกลับมาขายใหม่', 'นำกลับมาขาย'],
  ['งดขายในนัดที่เหลือ', 'งดขาย'],
  ['งดขายไม่มีผู้สู้ราคา', 'งดขาย'],
  ['ประกาศขาย', 'ประกาศ'],
  ['ขายออกแล้ว', 'ขายออก'],
  ['ถอนการยึด', 'ถอนการยึด'],
  ['ยกเลิก', 'ยกเลิก'],
  ['หมดอายุ', 'หมดอายุ'],
];

/** The one word a pill keeps, so a stack of events fits the plot: the chart
 *  tags หมดอายุประกาศ ไม่มีผู้สู้ราคา as หมดอายุ, and the price tooltip speaks
 *  the full label on hover. */
export function shortLabel(label: string): string {
  for (const [pfx, short] of SHORT_PREFIXES) {
    if (label.startsWith(pfx)) return short;
  }
  const first = label.split(/\s+/)[0] ?? label;
  return first.length > 14 ? `${first.slice(0, 13)}…` : first;
}
