import { Chart, type ChartConfiguration } from 'chart.js';
import { useEffect, useRef } from 'react';
import type { SensorPin } from '../../types';
import { setupCharts } from './chartSetup';

const FORECAST_H = 6;

/** 24 h history + 6 h linear forecast against the critical level. */
export function SensorChart({ pin: st }: { pin: SensorPin }) {
  const cv = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = cv.current;
    if (!canvas) return;
    setupCharts();
    const tail = st.hist.slice(-6), n = tail.length;
    let sx = 0, sy = 0, sxx = 0, sxy = 0; /* least-squares slope over the last 6 samples */
    tail.forEach((p, i) => { sx += i; sy += p.lv; sxx += i * i; sxy += i * p.lv; });
    const slope = (n * sxy - sx * sy) / Math.max(1e-6, n * sxx - sx * sx);
    const forecast = Array.from({ length: FORECAST_H }, (_, k) => +Math.max(0, tail[n - 1].lv + slope * (k + 1)).toFixed(2));
    const labels = st.hist.map(h => new Date(h.t).getHours() + ':00').concat(forecast.map((_, k) => '+' + (k + 1) + ' ชม.'));
    const tick = { color: '#666D62', font: { size: 9 } };
    const cfg: ChartConfiguration<'line', (number | null)[], string> = {
      type: 'line',
      data: {
        labels,
        datasets: [
          { data: [...st.hist.map(h => h.lv), ...Array<number | null>(FORECAST_H).fill(null)], borderColor: '#4C9AFF', backgroundColor: 'rgba(76,154,255,.12)', fill: true, tension: 0.35, pointRadius: 0, borderWidth: 2 },
          { data: labels.map(() => st.crit), borderColor: '#FF7A6B', borderDash: [6, 4], pointRadius: 0, borderWidth: 1.4 },
          { data: [...Array<number | null>(st.hist.length - 1).fill(null), tail[n - 1].lv, ...forecast], borderColor: '#FFC94D', borderDash: [4, 3], pointRadius: 0, borderWidth: 1.6, tension: 0.35 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
        plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
        scales: {
          x: { ticks: { ...tick, maxTicksLimit: 8 }, grid: { color: 'rgba(255,255,255,.04)' } },
          y: { suggestedMin: Math.max(0, st.lv - 1.5), suggestedMax: st.crit + 0.6, ticks: { ...tick, callback: v => v + ' ม.' }, grid: { color: 'rgba(255,255,255,.06)' } },
        },
      },
    };
    const ch = new Chart(canvas, cfg);
    return () => ch.destroy();
  }, [st]);

  return <canvas ref={cv} />;
}
