import { useLayoutEffect, useState, type RefObject } from 'react';

/**
 * Place a fixed popup above (or below, if no room) an anchor, right-aligned to it.
 *
 * The popup is measured against the space it actually has: above-first, but if the
 * top would run off the screen it drops below the trigger instead. When neither
 * side fits, the larger gap wins and the popup is clamped so it stays on screen.
 */
export function useAboveBelow(el: RefObject<HTMLElement | null>, anchor: HTMLElement | null, width: number, dep?: unknown): { left: number; top: number } {
  const [pos, setPos] = useState({ left: 0, top: 0 });
  useLayoutEffect(() => {
    const node = el.current;
    if (!node || !anchor) return;
    const r = anchor.getBoundingClientRect();
    const vh = window.innerHeight;
    const mh = node.offsetHeight || 300;
    const roomAbove = r.top - 8;
    const roomBelow = vh - r.bottom - 8;

    let top: number;
    if (mh <= roomAbove) top = r.top - mh - 6;          // preferred: above the button
    else if (mh <= roomBelow) top = r.bottom + 6;         // no headroom -> drop below
    else if (roomAbove >= roomBelow) top = Math.max(8, r.top - mh - 6);  // tighter: clamp
    else top = Math.min(r.bottom + 6, vh - mh - 8);

    setPos({ left: Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8)), top });
  }, [el, anchor, width, dep]);
  return pos;
}
