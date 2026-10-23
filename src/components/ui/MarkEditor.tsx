import { useEffect, useRef, useState } from 'react';
import { ICON_CHOICES, PRESET_COLORS } from '../../lib/richText';
import { parseMark } from '../../lib/markText';
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

  const wrapTag = (flag: 'b' | 'i' | 'u' | 'bg' | 'fg', hex?: string) => {
    const el = ta.current;
    if (!el) return;
    const s = el.selectionStart, e = el.selectionEnd;
    if (s == null || e == null) return;
    const open = flag === 'bg' || flag === 'fg' ? `<${flag}=#${hex}>` : `<${flag}>`;
    const close = `</${flag}>`;
    const mid = v.slice(s, e);
    /* Toggling off: a selection that is exactly one wrap unwraps. */
    if (mid === `${open}${mid.slice(open.length, mid.length - close.length)}${close}`) {
      const inner = mid.slice(open.length, mid.length - close.length);
      setV(v.slice(0, s) + inner + v.slice(e));
      requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s, s + inner.length); });
      return;
    }
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
        <button type="button" className={`${bSel} font-bold`} {...useTipProps('ตัวหนา <b>')} onClick={() => wrapTag('b')}>B</button>
        <button type="button" className={`${bSel} italic`} {...useTipProps('ตัวเอียง <i>')} onClick={() => wrapTag('i')}>I</button>
        <button type="button" className={`${bSel} underline`} {...useTipProps('ขีดเส้นใต้ <u>')} onClick={() => wrapTag('u')}>U</button>
        <div className="mx-0.5 h-4 w-px flex-none bg-line2" />
        <div className="relative">
          <button type="button" className={bSel} {...useTipProps('ใส่สัญลักษณ์')} onClick={() => setPicker(picker === 'emoji' ? '' : 'emoji')}>🙂</button>
          {picker === 'emoji' && (
            <div className="absolute left-0 top-full z-[99] mt-1 w-[212px] rounded-[8px] border border-line2 bg-panel p-1.5 shadow-panel">
              <div className="grid grid-cols-8 gap-0.5">
                {ICON_CHOICES.map(ic => (
                  <button
                    key={ic} type="button"
                    className="grid size-[22px] place-items-center rounded-[4px] text-[12px] transition hover:bg-panel2"
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
            type="button" className={bSel}
            {...useTipProps('สีพื้นหลังข้อความ <bg=#hex>')}
            onClick={() => setPicker(picker === 'bg' ? '' : 'bg')}
            style={{ fontWeight: 700 }}
          >
            <span className="rounded-[3px] bg-[#FFD93D] px-1 text-[10px] text-black">A</span>
          </button>
          {picker === 'bg' && (
            <div className="absolute left-0 top-full z-[99] mt-1 flex w-[150px] flex-wrap gap-1 rounded-[8px] border border-line2 bg-panel p-1.5 shadow-panel">
              {PRESET_COLORS.map(c => (
                <button key={c} type="button" className={sw} style={{ background: c }} onClick={() => { wrapTag('bg', c); setPicker(''); }} />
              ))}
            </div>
          )}
        </div>
        <div className="relative">
          <button
            type="button" className={bSel}
            {...useTipProps('สีตัวอักษร <fg=#hex>')}
            onClick={() => setPicker(picker === 'fg' ? '' : 'fg')}
          >
            <span className="text-[11px] text-[#FF6B5E]">A</span>
          </button>
          {picker === 'fg' && (
            <div className="absolute left-0 top-full z-[99] mt-1 flex w-[150px] flex-wrap gap-1 rounded-[8px] border border-line2 bg-panel p-1.5 shadow-panel">
              {PRESET_COLORS.map(c => (
                <button key={c} type="button" className={sw} style={{ background: c }} onClick={() => { wrapTag('fg', c); setPicker(''); }} />
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
        rows={3}
        className="mb-2 w-full resize-y rounded-[6px] border border-line2 bg-bg px-2 py-1 text-[12px] leading-snug outline-none focus:border-accent"
      />

      {/* Live preview — markup applied as parseMark will render it. */}
      <div className="mb-2 rounded-[6px] border border-line2 bg-bg px-2 py-1.5 text-[11.5px] whitespace-pre-wrap break-words">
        <RichPreview value={v || 'ตัวอย่างโปร่ง <b>ชื่อ</b>'} />
      </div>

      <div className="flex justify-end gap-1.5">
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

/* Local preview shim — the full RichText needs nothing more, but keeps this
   file free of the whole-field style plumbing. */
function RichPreview({ value }: { value: string }) {
  const spans = parseMark(value);
  return <span className="min-w-0">{spans.map((sp, i) => <span key={i} style={sp.css}>{sp.text}</span>)}</span>;
}
