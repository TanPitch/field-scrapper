/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      /* Colors point at CSS variables so the graphite / OLED theme switch
         (body[data-theme]) keeps working without rebuilding classes. */
      colors: {
        bg: 'var(--bg)',
        panel: 'var(--panel)',
        panel2: 'var(--panel2)',
        line: 'var(--border)',
        line2: 'var(--border2)',
        ink: 'var(--text)',
        dim: 'var(--dim)',
        dim2: 'var(--dim2)',
        accent: 'var(--accent)',
        'accent-dim': 'var(--accent-dim)',
        danger: 'var(--danger)',
        'accent-ink': '#151B06',
      },
      fontFamily: {
        /* Noto Sans Thai for every label, number and heading — Thai shaping is
           consistent across weights, which Bai Jamjuree does not give us. */
        sans: ["'Noto Sans Thai'", 'sans-serif'],
        display: ["'Noto Sans Thai'", 'sans-serif'],
      },
      keyframes: {
        tin: { from: { opacity: '0', transform: 'translateX(14px)' } },
        rot: { to: { transform: 'rotate(360deg)' } },
        pulse2: {
          '0%': { transform: 'scale(.45)', opacity: '.9' },
          '75%': { transform: 'scale(1.35)', opacity: '0' },
          '100%': { opacity: '0' },
        },
        scan: { to: { top: '130%' } },
      },
      animation: {
        tin: 'tin .18s ease',
        spin2: 'rot .8s linear infinite',
        pulse2: 'pulse2 2.4s infinite',
        scan: 'scan 3.2s linear infinite',
      },
      transitionTimingFunction: { panel: 'cubic-bezier(.4,0,.2,1)' },
    },
  },
  plugins: [],
};
