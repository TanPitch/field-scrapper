import { useLayoutEffect, useState, type RefObject } from 'react';

/** Place a fixed popup above (or below, if no room) an anchor, right-aligned to it. */
export function useAboveBelow(el: RefObject<HTMLElement | null>, anchor: HTMLElement | null, width: number, dep?: unknown): { left: number; top: number } {
  const [pos, setPos] = useState({ left: 0, top: 0 });
  useLayoutEffect(() => {
    const node = el.current;
    if (!node || !anchor) return;
    const r = anchor.getBoundingClientRect();
    const mh = node.offsetHeight || 300;
    let top = r.top - mh - 6;
    if (top < 8) top = r.bottom + 6;
    setPos({ left: Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8)), top });
  }, [el, anchor, width, dep]);
  return pos;
}
