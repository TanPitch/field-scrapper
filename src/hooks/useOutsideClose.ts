import { useEffect, type RefObject } from 'react';

/**
 * Calls onClose on a pointer-down outside every given element (and on Escape).
 *
 * `toleratePortals` exists for surfaces that host portalled popups of their own
 * (e.g. the settings panel hosting the colour picker). Without it, a click inside
 * such a popup is "outside" the panel and would close the panel. Do NOT enable it
 * for watchers whose own dropdown lives inside a portal — then clicks elsewhere in
 * that portal would be ignored and the dropdown could never be dismissed.
 */
export function useOutsideClose(
  refs: RefObject<HTMLElement | null>[],
  onClose: () => void,
  enabled = true,
  toleratePortals = false,
): void {
  useEffect(() => {
    if (!enabled) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (t && refs.some(r => r.current?.contains(t))) return;
      if (toleratePortals && t instanceof Element && t.closest('[data-portal]')) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('keydown', key);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, onClose, toleratePortals]);
}