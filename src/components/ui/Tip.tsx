import { useEffect, type ReactNode } from 'react';
import { delegate, type Instance } from 'tippy.js';
import 'tippy.js/dist/tippy.css';

/**
 * Tooltips, backed by tippy.js.
 *
 * One delegated instance is bound to `document.body` for every `[data-tip]`
 * element, so nothing needs a React wrapper per trigger and the hooks below stay
 * hook-free — which matters because they are called inside `.map()` callbacks
 * (table columns, rail buttons), where hooks are not allowed.
 *
 * Two opt-in attributes:
 *   data-tip               text to show
 *   data-tip-if-clipped    only show when the element actually clips its text
 */

const TARGET = '[data-tip]';
const SHOW_DELAY = 260;

/** Cancel the show when the trigger opted into "only if clipped" and isn't. */
function isSuppressed(reference: HTMLElement): boolean {
  if (!reference.hasAttribute('data-tip-if-clipped')) return false;
  return reference.scrollWidth <= reference.clientWidth + 1;
}

export function TipProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const instances: Instance[] = delegate('body', {
      target: TARGET,
      theme: 'fs',
      /* placement + boundaryPadding keep the bubble (and its arrow) on screen */
      placement: 'top',
      /* follow the reference while the page scrolls, instead of re-placing on hover */
      moveTransition: 'transform 160ms cubic-bezier(0.22, 1, 0.36, 1)',
      delay: [SHOW_DELAY, 0],
      duration: [120, 80],
      arrow: true,
      maxWidth: 260,
      interactive: false,
      hideOnClick: true,
      appendTo: () => document.body,
      content: (reference: Element) => (reference as HTMLElement).getAttribute('data-tip') ?? '',
      onShow(instance: Instance) {
        /* returning false cancels the show, so clipped-only triggers stay silent */
        if (isSuppressed(instance.reference as HTMLElement)) return false;
      },
    });
    return () => {
      instances.forEach(i => i.destroy());
    };
  }, []);

  return <>{children}</>;
}

/** Props that attach a tooltip. Returns only a data attribute — hook free. */
export function useTipProps(text: string | undefined | false | null): { 'data-tip': string } | Record<string, never> {
  return text ? { 'data-tip': text } : {};
}

/**
 * Like `useTipProps`, but the tooltip only appears when the element actually clips
 * its text — use for table cells so short values do not get a tooltip.
 */
export function useClipTip(text: string | undefined | false | null): Record<string, string> {
  return text ? { 'data-tip': text, 'data-tip-if-clipped': '' } : {};
}

/** `<Tip text="…">` for elements that cannot take a spread. */
export function Tip({ text, children, ...rest }: { text?: string; children: ReactNode } & Record<string, unknown>) {
  return <span {...rest} {...useTipProps(text)}>{children}</span>;
}