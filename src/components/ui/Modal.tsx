import { X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Small self-contained popup panel — the password / 2FA dialogs of the user
 * pane, the admin password reset, anything that needs a form more capable than
 * the yes/no Confirm but not a full page.
 *
 * Mounts to document.body like CoordGapsPane's fullscreen view and carries the
 * same `data-portal` marker, so clicks and scrolls inside never register as
 * "outside" to the settings drawer's dismissal logic. Escape and the backdrop
 * close the modal but deliberately stop propagation first — closing this
 * panel must not also close the drawer it was opened from.
 */
export function Modal({ title, onClose, children }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return createPortal(
    <div
      data-portal
      className="fixed inset-0 z-[400] grid place-items-center bg-bg/70 p-4 backdrop-blur-[2px]"
      onPointerDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-[380px] rounded-[14px] border border-line2 bg-panel p-5 shadow-[0_24px_60px_rgba(0,0,0,.6)]">
        <div className="flex items-center gap-2 text-[13.5px] font-semibold text-ink">
          {title}
          <button
            type="button"
            className="ml-auto cursor-pointer rounded-md border border-line2 bg-panel p-1 text-dim transition hover:text-ink"
            aria-label="ปิด"
            onClick={onClose}
          >
            <X size={13} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
