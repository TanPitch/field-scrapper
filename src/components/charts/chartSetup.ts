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
        /* pin to the edge the event actually sits beyond, arrow pointing that way */
        if (side === 'left') pill(ctx, `${ev.label} ↩`, chartArea.left + 2, y, ev.color, ev.ink, 'left');
        else pill(ctx, `↪ ${ev.label}`, chartArea.right - 2, y, ev.color, ev.ink, 'right');
      });
      ctx.restore();
    },
  };
}
