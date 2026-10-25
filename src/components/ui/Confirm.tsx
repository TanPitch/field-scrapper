import { AlertTriangle } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { btn, btnAcc, inp } from './styles';

export interface ConfirmOpts {
  title: string;
  body: ReactNode;
  confirmText?: string;
  danger?: boolean;
  /** When set, confirm stays disabled until this exact text is typed. */
  requireText?: string;
}

export interface ConfirmState extends ConfirmOpts {
  resolve: (ok: boolean) => void;
}

/**
 * Blocking confirm for destructive actions. Mounted once at App level and driven
 * by `useConfirm()`, so any component can await a yes/no without owning state.
 */
export function Confirm({ state, close }: { state: ConfirmState | null; close: () => void }) {
  const [typed, setTyped] = useState('');
  const danger = state?.danger !== false;

  useEffect(() => { setTyped(''); }, [state]);
  useEffect(() => {
    if (!state) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { state.resolve(false); close(); }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [state, close]);

  if (!state) return null;
  const canConfirm = !state.requireText || typed.trim() === state.requireText;

  return (
    <div className="fixed inset-0 z-[400] grid place-items-center bg-bg/70 p-4 backdrop-blur-[2px]">
      {/* data-selectable: the body is `user-select:none` by default; without
          this the confirm's title/body (the text you are about to type or copy,
          like a username) could not be selected at all. */}
      <div className="w-full max-w-[380px] rounded-[14px] border border-line2 bg-panel p-5 shadow-[0_24px_60px_rgba(0,0,0,.6)]" data-selectable>
        <div className={`flex items-center gap-2 text-[13.5px] font-semibold ${danger ? 'text-[#FF8B7D]' : 'text-ink'}`}>
          <AlertTriangle size={16} />{state.title}
        </div>
        <div className="mt-2 text-[11.5px] leading-[1.75] text-dim">{state.body}</div>

        {state.requireText && (
          <input
            autoFocus
            className={`${inp} mt-3`}
            value={typed}
            onChange={e => setTyped(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && canConfirm) { state.resolve(true); close(); } }}
            placeholder={`พิมพ์ ${state.requireText} เพื่อยืนยัน`}
          />
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button className={btn} onClick={() => { state.resolve(false); close(); }}>ยกเลิก</button>
          <button
            className={danger ? `${btnAcc} !border-[#E5484D] !bg-[#E5484D] !text-white disabled:opacity-40` : btnAcc}
            disabled={!canConfirm}
            onClick={() => { state.resolve(true); close(); }}
          >
            {state.confirmText ?? 'ยืนยัน'}
          </button>
        </div>
      </div>
    </div>
  );
}
