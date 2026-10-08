import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

/** Which side of the bubble the anchor sits on (drives the arrow direction). */
type Side = 'top' | 'bottom';
interface TipPos {
  /** bubble left/top in viewport px */
  x: number;
  y: number;
  side: Side;
  /** arrow offset from the bubble's left edge, so it points at the anchor */
  arrow: number;
  /** bubble width, used to clamp the arrow inside the box */
  w: number;
}

interface TipCtx { show: (el: HTMLElement, text: string) => void; hide: () => void }
const Ctx = createContext<TipCtx | null>(null);

const GAP = 8;
const ARROW = 6;      // half the triangle width
const MIN_W = 90;     // narrowest bubble, used before measurement
const SHOW_DELAY = 260;
/** Bubble edge colour, read by the triangle so both match the theme. */
const EDGE = 'var(--tip-edge, var(--border2, #333A31))';

const noopCtx: TipCtx = { show: () => { }, hide: () => { } };

/**
 * Custom tooltip provider. Any descendant can carry `data-tip="…"` and get a
 * bubble with an arrow that tracks the exact anchor — no native `title`, and no
 * per-element hooks, so it is safe inside `.map()` where hooks cannot be called.
 *
 * There is deliberately no fade: the bubble only ever moves, so a tooltip that is
 * still up when you move to a nearby element just slides rather than blinking.
 */
export function TipProvider({ children }: { children: ReactNode }) {
  const [pos, setPos] = useState<TipPos>({ x: 0, y: 0, side: 'top', arrow: MIN_W / 2, w: MIN_W });
  const [mounted, setMounted] = useState<string | null>(null);
  const anchor = useRef<HTMLElement | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const box = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const el = anchor.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    /* measure the real bubble so clamping uses its actual width */
    const w = box.current?.offsetWidth || MIN_W;
    /* keep the bubble on screen, then aim the arrow back at the anchor centre */
    const x = Math.min(Math.max(r.left + r.width / 2, w / 2 + 8), Math.max(w / 2 + 8, vw - w / 2 - 8));
    /* prefer above; flip below when the anchor is near the top of the viewport */
    const side: Side = r.top > 56 ? 'top' : 'bottom';
    setPos({
      x,
      y: side === 'top' ? r.top - GAP : r.bottom + GAP,
      side,
      w,
      /* arrow centre, clamped so the triangle never leaves the bubble */
      arrow: Math.min(Math.max(r.left + r.width / 2 - (x - w / 2), ARROW + 4), w - ARROW - 4),
    });
  }, []);

  const show = useCallback((el: HTMLElement, t: string) => {
    anchor.current = el;
    setMounted(t);
    place();
  }, [place]);

  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    setMounted(null);
    anchor.current = null;
  }, []);

  /* one delegated listener for the whole app: pointerover bubbles, so this also
     covers elements rendered in loops and inside portals */
  useEffect(() => {
    const enter = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      const host = t?.closest?.('[data-tip]') as HTMLElement | null;
      const tip = host?.getAttribute('data-tip');
      window.clearTimeout(timer.current);
      if (!host || !tip) { hide(); return; }
      /* opt-in: only show when the text is actually clipped (table cells) */
      if (host.hasAttribute('data-tip-if-clipped') && host.scrollWidth <= host.clientWidth + 1) { hide(); return; }
      timer.current = window.setTimeout(() => show(host, tip), SHOW_DELAY);
    };
    const leave = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      /* moving within the same tooltip element keeps it up */
      if (t?.closest?.('[data-tip]') === anchor.current) return;
      if (t?.closest?.('[data-tip]')) hide();
    };
    const press = () => hide();
    document.addEventListener('pointerover', enter);
    document.addEventListener('pointerout', leave);
    document.addEventListener('pointerdown', press, true);
    return () => {
      document.removeEventListener('pointerover', enter);
      document.removeEventListener('pointerout', leave);
      document.removeEventListener('pointerdown', press, true);
      window.clearTimeout(timer.current);
    };
  }, [hide, show]);

  /* follow the anchor while it scrolls or resizes, or when the bubble resizes */
  useEffect(() => {
    if (!mounted) return;
    const on = () => place();
    window.addEventListener('scroll', on, true);
    window.addEventListener('resize', on);
    const ro = box.current ? new ResizeObserver(on) : null;
    if (ro && box.current) ro.observe(box.current);
    return () => {
      window.removeEventListener('scroll', on, true);
      window.removeEventListener('resize', on);
      ro?.disconnect();
    };
  }, [mounted, place]);

  const value = useMemo(() => ({ show, hide }), [show, hide]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {mounted && createPortal(
        <div
          ref={box}
          className="pointer-events-none fixed z-[200] max-w-[260px]"
          style={{
            left: pos.x,
            top: pos.y,
            transform: `translate(-50%, ${pos.side === 'top' ? 'calc(-100% - 7px)' : '7px'})`,
          }}
          role="tooltip"
        >
          {/* arrow: a CSS triangle, offset so its point lands on the anchor centre */}
          <span
            className="absolute size-0 border-y-[6px] border-y-transparent"
            style={{
              left: pos.arrow,
              transform: 'translateX(-50%)',
              ...(pos.side === 'top'
                ? { top: '100%', borderTop: `7px solid ${EDGE}` }
                : { bottom: '100%', borderBottom: `7px solid ${EDGE}` }),
            }}
          />
          <span
            className="relative block whitespace-pre-wrap rounded-lg border bg-[#141714] px-2 py-1 text-center text-[11.5px] leading-normal text-ink shadow-[0_10px_26px_rgba(0,0,0,.6)]"
            style={{ borderColor: EDGE }}
          >
            {mounted}
          </span>
        </div>,
        document.body,
      )}
    </Ctx.Provider>
  );
}

/** Imperative API (show/hide). Safe to call outside a provider. */
export function useTip(): TipCtx {
  return useContext(Ctx) ?? noopCtx;
}

/**
 * Props that attach a tooltip. Returns only a data attribute — deliberately hook
 * free, so it is legal to call inside `.map()` callbacks.
 */
export function useTipProps(text: string | undefined | false | null): { 'data-tip': string } | Record<string, never> {
  return text ? { 'data-tip': text } : {};
}

/**
 * Like `useTipProps`, but the bubble only appears when the element actually clips
 * its text — use for table cells so short values do not get a tooltip.
 */
export function useClipTip(text: string | undefined | false | null): Record<string, string> {
  return text ? { 'data-tip': text, 'data-tip-if-clipped': '' } : {};
}

/** `<Tip text="…">` for elements that cannot take a spread. */
export function Tip({ text, children, ...rest }: { text?: string; children: ReactNode } & Record<string, unknown>) {
  return <span {...rest} {...useTipProps(text)}>{children}</span>;
}