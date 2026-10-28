import { useEffect, useRef, useState } from 'react';
import { ICON_CHOICES, PRESET_COLORS } from '../../lib/richText';
import { useTipProps } from './Tip';

/**
 * The WYSIWYG-flavoured editor behind the table's ชื่อกำกับ / หมายเหตุกำกับ
 * columns (one instance, whichever column was clicked; one textarea).
 *
 * It LOOKS like a rich editor — toolbar over the text — but it stores markup
 * rather than documents: B/I/U/highlight/ink wrap the selection in `<b>`,
 * `<i>`, `<u>`, `<bg=#hex>`, `<fg=#hex>` tags that stay visible in the
 * textarea, exactly like the user asked. lib/markText is the single parser.
 *
 * The first version lost the textarea's selection the moment a toolbar button
 * was pressed (mousedown moved focus to the button, selectionStart collapsed),
 * so "styling text" wrapped nothing. Every toolbar button now swallows
 * mousedown — the click still fires, but focus and the highlighted range stay
 * in the textarea. That was still not enough in the field: palette buttons and
 * the programmatically-peeked range could leave selectionStart collapsed, so
 * the editor keeps its own copy of the selection (updated on
 * mouseup/keyup/select) and wraps from it whenever the live one has collapsed.
 *
 * A ล้าง button empties the field being edited — clearing a หมายเหตุ without
 * having to select-all-and-delete.
 *
 * Click-away and Escape COMMIT, not discard — losing a typed note to a stray
 * click would be hostile.
 */
export function MarkEditor({
  label, text, onDone, onClose,
}: {
  label: string;
  text: string;
  onDone: (next: string) => void;
  onClose: () => void;
}) {
  const [v, setV] = useState(text);
  const ta = useRef<HTMLTextAreaElement>(null);
  const box = useRef<HTMLDivElement>(null);
  /* The selection is remembered outside the DOM. Even with mousedown
     swallowed on every button, the textarea's own selectionStart can read
     collapsed when a button is pressed (palette swatches move the caret,
     some engines purify the range on the programmatic peek), so "select
     text, click a style" wrapped nothing — the visible bug the user filed.
     mouseup / keyup / select re-record the range as the caret moves;
     wrapTag falls back to the remembered one whenever the live selection
     has collapsed. */
  const sel = useRef<[number, number]>([text.length, text.length]);
  const rememberSel = () => {
    const el = ta.current;
    if (el) sel.current = [el.selectionStart ?? 0, el.selectionEnd ?? 0];
  };
  const [picker, setPicker] = useState<'' | 'emoji' | 'bg' | 'fg'>('');

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) { onDone(v); onClose(); }
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { onDone(v); onClose(); } };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  });

  /** Toolbar buttons must not take focus from the textarea, or the selection
   *  they are supposed to wrap is gone before onClick reads it. */
  const keepSel = (e: React.MouseEvent) => { e.preventDefault(); };

  const wrapTag = (flag: 'b' | 'i' | 'u' | 'bg' | 'fg', hex?: string) => {
    const el = ta.current;
    if (!el) return;
    /* Live selection first, the remembered one as fallback — see sel. The
       remembered range belongs to the same v (nothing else edits between the
       events that record it and this click). */
    let s = el.selectionStart ?? 0, e = el.selectionEnd ?? s;
    if (s === e && sel.current[0] !== sel.current[1]) {
      s = Math.min(sel.current[0], v.length);
      e = Math.min(sel.current[1], v.length);
    }
    const open = flag === 'bg' || flag === 'fg' ? `<${flag}=#${hex}>` : `<${flag}>`;
    const close = `</${flag}>`;
    const mid = v.slice(s, e);
    /* Toggling off: a selection that is exactly one wrap unwraps. */
    if (mid === `${open}${mid.slice(open.length, mid.length - close.length)}${close}`) {
      const inner = mid.slice(open.length, mid.length - close.length);
      sel.current = [s, s + inner.length];
      setV(v.slice(0, s) + inner + v.slice(e));
      requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s, s + inner.length); });
      return;
    }
    sel.current = [s + open.length, s + open.length + mid.length];
    setV(v.slice(0, s) + open + mid + close + v.slice(e));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + open.length, s + open.length + mid.length); });
  };

  const bSel = 'grid size-[22px] place-items-center rounded-[5px] border border-line2 text-[11px] font-semibold text-dim transition hover:bg-panel2 hover:text-ink';
  const sw = 'size-[15px] shrink-0 rounded-[4px] border border-line2 transition hover:scale-110';

  return (
    <div
      ref={box}
      className="w-[264px] rounded-[9px] border border-line2 bg-panel p-2 shadow-panel"
      onClick={e => e.stopPropagation()}
    >
      <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[.08em] text-dim2">{label}</div>

      {/* The toolbar sits over the text, editor-style. Colour buttons open a
          small palette; emoji inserts a plain character (no tag needed). */}
      <div className="mb-1.5 flex items-center gap-1">
        <button type="button" className={`${bSel} font-bold`} onMouseDown={keepSel} {...useTipProps('ตัวหนา <b>')} onClick={() => wrapTag('b')}>B</button>
        <button type="button" className={`${bSel} italic`} onMouseDown={keepSel} {...useTipProps('ตัวเอียง <i>')} onClick={() => wrapTag('i')}>I</button>
        <button type="button" className={`${bSel} underline`} onMouseDown={keepSel} {...useTipProps('ขีดเส้นใต้ <u>')} onClick={() => wrapTag('u')}>U</button>
        <div className="mx-0.5 h-4 w-px flex-none bg-line2" />
        <div className="relative">
          <button type="button" className={bSel} onMouseDown={keepSel} {...useTipProps('ใส่สัญลักษณ์')} onClick={() => setPicker(picker === 'emoji' ? '' : 'emoji')}>🙂</button>
          {picker === 'emoji' && (
            <div className="absolute left-0 top-full z-[99] mt-1 w-[212px] rounded-[8px] border border-line2 bg-panel p-1.5 shadow-panel">
              <div className="grid grid-cols-8 gap-0.5">
                {ICON_CHOICES.map(ic => (
                  <button
                    key={ic} type="button"
                    className="grid size-[22px] place-items-center rounded-[4px] text-[12px] transition hover:bg-panel2"
                    onMouseDown={keepSel}
                    onClick={() => {
                      const el = ta.current;
                      const at = el ? el.selectionStart ?? v.length : v.length;
                      setV(v.slice(0, at) + ic + v.slice(at));
                      setPicker('');
                      requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + ic.length, at + ic.length); });
                    }}
                  >
                    {ic}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="relative">
          <button
            type="button" className={bSel} onMouseDown={keepSel}
            {...useTipProps('สีพื้นหลังข้อความ <bg=#hex>')}
            onClick={() => setPicker(picker === 'bg' ? '' : 'bg')}
            style={{ fontWeight: 700 }}
          >
            <span className="rounded-[3px] bg-[#FFD93D] px-1 text-[10px] text-black">A</span>
          </button>
          {picker === 'bg' && (
            <div className="absolute left-0 top-full z-[99] mt-1 flex w-[150px] flex-wrap gap-1 rounded-[8px] border border-line2 bg-panel p-1.5 shadow-panel">
              {PRESET_COLORS.map(c => (
                <button key={c} type="button" className={sw} onMouseDown={keepSel} style={{ background: c }} onClick={() => { wrapTag('bg', c); setPicker(''); }} />
              ))}
            </div>
          )}
        </div>
        <div className="relative">
          <button
            type="button" className={bSel} onMouseDown={keepSel}
            {...useTipProps('สีตัวอักษร <fg=#hex>')}
            onClick={() => setPicker(picker === 'fg' ? '' : 'fg')}
          >
            <span className="text-[11px] text-[#FF6B5E]">A</span>
          </button>
          {picker === 'fg' && (
            <div className="absolute left-0 top-full z-[99] mt-1 flex w-[150px] flex-wrap gap-1 rounded-[8px] border border-line2 bg-panel p-1.5 shadow-panel">
              {PRESET_COLORS.map(c => (
                <button key={c} type="button" className={sw} onMouseDown={keepSel} style={{ background: c }} onClick={() => { wrapTag('fg', c); setPicker(''); }} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* One textarea: the editor is shared between the two columns, and the
          column clicked decides which field this edits. */}
      <textarea
        autoFocus
        value={v}
        onChange={e => setV(e.target.value)}
        onSelect={rememberSel}
        onMouseUp={rememberSel}
        onKeyUp={rememberSel}
        rows={3}
        className="mb-2 w-full resize-y rounded-[6px] border border-line2 bg-bg px-2 py-1 text-[12px] leading-snug outline-none focus:border-accent"
      />

      <div className="flex items-center gap-1.5">
        {/* Clear: empties THIS field (the one being edited), not the other
            column's text — the commit that follows nothing typed is the last
            non-empty previous value's absence, i.e. a blank cell. */}
        <button
          type="button"
          className="mr-auto rounded-[6px] border border-line2 px-2 py-1 text-[11px] text-dim hover:bg-panel2 hover:text-ink"
          onMouseDown={keepSel}
          onClick={() => { setV(''); sel.current = [0, 0]; }}
        >
          ล้าง
        </button>
        <button
          type="button"
          className="rounded-[6px] border border-line2 px-2 py-1 text-[11px] text-dim hover:bg-panel2"
          onClick={() => { onClose(); }}
        >
          ยกเลิก
        </button>
        <button
          type="button"
          className="rounded-[6px] bg-accent px-2.5 py-1 text-[11px] font-semibold text-accent-ink"
          onClick={() => { onDone(v); onClose(); }}
        >
          บันทึก
        </button>
      </div>
    </div>
  );
}
