import { useLayoutEffect, useRef, useState } from 'react';

interface SegProps<T extends string> {
  items: readonly (readonly [T, string])[];
  value: T;
  onChange: (v: T) => void;
}

/** Segmented control with a sliding accent thumb. */
export function Seg<T extends string>({ items, value, onChange }: SegProps<T>) {
  const root = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState({ left: 0, width: 0 });
  const [ready, setReady] = useState(false);
  const didPlace = useRef(false);

  useLayoutEffect(() => {
    const measure = () => {
      const on = root.current?.querySelector<HTMLElement>('[data-on="true"]');
      if (on) setThumb({ left: on.offsetLeft, width: on.offsetWidth });
      if (!didPlace.current) {
        didPlace.current = true;
        requestAnimationFrame(() => setReady(true));
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (root.current) ro.observe(root.current);
    return () => ro.disconnect();
  }, [value, items]);

  return (
    <div ref={root} className="relative inline-flex gap-0.5 rounded-lg border border-line2 bg-bg p-0.5">
      <span
        className={`pointer-events-none absolute bottom-0.5 top-0.5 rounded-md bg-accent ${ready ? 'transition-[left,width] duration-200 ease-panel' : ''}`}
        style={{ left: thumb.left, width: thumb.width }}
      />
      {items.map(([v, label]) => (
        <button
          key={v}
          type="button"
          data-on={v === value}
          onClick={() => onChange(v)}
          className={`relative z-[1] cursor-pointer whitespace-nowrap rounded-md px-2.5 py-1 text-[11.5px] transition-colors ${
            v === value ? 'font-semibold text-accent-ink' : 'font-medium text-dim hover:text-ink'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}