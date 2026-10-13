import { useEffect, useRef, useState } from 'react';
import {
  ICON_CHOICES, PRESET_COLORS, isColor, normStyle, styleToCss,
  type RichTextStyle,
} from '../../lib/richText';
import { useTipProps } from './Tip';
import { ColorButton } from './ColorButton';

/**
 * Renders a label + note with their own styling.
 *
 * Name and note are styled separately: bolding a whole note to emphasise one
 * word inside it is not what someone means, so a single shared style is the
 * wrong shape. `nameStyle` / `noteStyle` fall back to `style` for older data.
 *
 * `note` is plain text, never markup — see lib/richText for why.
 */
export function RichText({
  value, style, note, noteStyle, className = '', maxLines,
}: {
  value: string | null | undefined;
  style?: RichTextStyle | null;
  note?: string | null;
  noteStyle?: RichTextStyle | null;
  className?: string;
  maxLines?: number;
}) {
  const s = normStyle(style);
  const ns = normStyle(noteStyle ?? style);
  const text = (value ?? '').trim();

  return (
    <span
      className={className}
      style={{
        ...styleToCss(s),
        display: 'inline-block',
        ...(maxLines && note
          ? {
              display: '-webkit-box',
              WebkitLineClamp: maxLines,
              WebkitBoxOrient: 'vertical' as const,
              overflow: 'hidden',
            }
          : null),
      }}
    >
      {s.badge && (
        <span aria-hidden className="mr-1" style={isColor(s.fg) ? { color: s.fg } : undefined}>
          {s.badge}
        </span>
      )}
      {text}
      {note ? (
        <span className="ml-1.5 text-[10px] text-dim2" style={styleToCss(ns)}>
          {ns.badge && <span aria-hidden className="mr-0.5">{ns.badge}</span>}
          {note}
        </span>
      ) : null}
    </span>
  );
}

/* --------------------------------------------------------------- editor */

const btn = (on: boolean) =>
  `grid size-[22px] place-items-center rounded-[5px] border text-[11px] font-semibold transition ${
    on ? 'border-accent bg-accent-dim text-accent' : 'border-line2 text-dim hover:bg-panel2 hover:text-ink'
  }`;

/**
 * One style toolbar. Used twice by the editor below when `dual` is set, so the
 * name and the note get independent controls instead of one shared row.
 */
function StyleRow({
  s, onChange, compact,
}: {
  s: RichTextStyle;
  onChange: (next: RichTextStyle) => void;
  compact?: boolean;
}) {
  const toggle = (k: 'b' | 'i' | 'u') => onChange({ ...s, [k]: !s[k] });
  /* One button that opens a panel, rather than a strip of glyph buttons. The
     strip was ~12 fixed choices in a row; the user wants the full set plus a
     clear, and a long strip crowds out the colour rows on a narrow panel. */
  const [picker, setPicker] = useState(false);
  const iconRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!picker) return;
    const away = (e: MouseEvent) => {
      if (iconRef.current && !iconRef.current.contains(e.target as Node)) setPicker(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [picker]);

  return (
    <div className="mb-1.5">
      <div className="mb-1 flex items-center gap-1">
        <button type="button" className={btn(!!s.b)} onClick={() => toggle('b')} title="ตัวหนา">B</button>
        <button type="button" className={`${btn(!!s.i)} italic`} onClick={() => toggle('i')} title="ตัวเอียง">I</button>
        <button type="button" className={`${btn(!!s.u)} underline`} onClick={() => toggle('u')} title="ขีดเส้นใต้">U</button>
        <div className="mx-0.5 h-4 w-px bg-line2" />

        <div ref={iconRef} className="relative">
          <button
            type="button"
            {...useTipProps('สัญลักษณ์นำหน้า')}
            onClick={() => setPicker((v) => !v)}
            className={`grid size-[22px] place-items-center rounded-[5px] border text-[12px] transition ${
              s.badge ? 'border-accent bg-accent-dim' : 'border-line2 text-dim hover:bg-panel2 hover:text-ink'
            }`}
          >
            {s.badge ?? '🙂'}
          </button>

          {picker && (
            <div
              className="absolute left-0 top-full z-[99] mt-1 w-[212px] rounded-[8px] border border-line2 bg-panel p-1.5 shadow-panel"
              onClick={e => e.stopPropagation()}
            >
              <div className="grid grid-cols-8 gap-0.5">
                {ICON_CHOICES.map(ic => (
                  <button
                    key={ic}
                    type="button"
                    className={`grid size-[22px] place-items-center rounded-[4px] text-[12px] transition ${
                      s.badge === ic ? 'bg-accent-dim ring-1 ring-accent' : 'hover:bg-panel2'
                    }`}
                    onClick={() => { onChange({ ...s, badge: ic }); setPicker(false); }}
                  >
                    {ic}
                  </button>
                ))}
              </div>
              {/* Clear is explicit. Toggling the one already set works, but a
                  discoverable "remove" is better than making the user guess. */}
              <button
                type="button"
                className="mt-1.5 w-full rounded-[5px] border border-line2 py-1 text-[10.5px] text-dim hover:bg-panel2 hover:text-ink"
                onClick={() => { onChange({ ...s, badge: '' }); setPicker(false); }}
              >
                ล้างสัญลักษณ์
              </button>
            </div>
          )}
        </div>
      </div>
      {!compact && (
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-dim2">พื้น</span>
          {PRESET_COLORS.map(c => (
            <button
              key={`bg${c}`}
              type="button"
              {...useTipProps('สีพื้นหลัง')}
              className={`size-[15px] rounded-[4px] border transition ${s.bg === c ? 'ring-1 ring-accent' : 'border-line2'}`}
              style={{ background: c }}
              onClick={() => onChange({ ...s, bg: s.bg === c ? '' : c })}
            />
          ))}
          {/* Custom colour. ColorButton is an HSV picker in a portal — not a
              native <input type="color">, which renders the OS dialog, ignores
              the panel's own contrast rules, and cannot be themed. */}
          <ColorButton
            value={s.bg || '#000000'}
            title="เลือกสีพื้นหลังเอง"
            onChange={hex => onChange({ ...s, bg: hex })}
            className="size-[15px] flex-none rounded-[4px] border border-dashed border-line2"
            style={{
              background: s.bg || 'repeating-conic-gradient(rgba(127,127,127,.5) 0% 25%, transparent 0% 50%) 50% / 6px 6px',
            }}
          />
        </div>
      )}
      {!compact && (
        <div className="mt-1 flex items-center gap-1">
          <span className="text-[10px] text-dim2">ตัวอักษร</span>
          {PRESET_COLORS.map(c => (
            <button
              key={`fg${c}`}
              type="button"
              {...useTipProps('สีตัวอักษร')}
              className={`grid size-[15px] place-items-center rounded-[4px] border transition ${s.fg === c ? 'ring-1 ring-accent' : 'border-line2'}`}
              style={{ background: c }}
              onClick={() => onChange({ ...s, fg: s.fg === c ? '' : c })}
            />
          ))}
          <ColorButton
            value={s.fg || '#000000'}
            title="เลือกสีตัวอักษรเอง"
            onChange={hex => onChange({ ...s, fg: hex })}
            className="size-[15px] flex-none rounded-[4px] border border-dashed border-line2"
            style={{
              background: s.fg || 'repeating-conic-gradient(rgba(127,127,127,.5) 0% 25%, transparent 0% 50%) 50% / 6px 6px',
            }}
          />
        </div>
      )}
    </div>
  );
}

export interface AnnotationDraft {
  value: string;
  note: string;
  style: RichTextStyle;
  noteStyle: RichTextStyle;
}

/**
 * Small popover editor for a name and/or note.
 *
 * `dual` renders a separate toolbar for each field. Without it (table columns)
 * one toolbar covers both, which is fine there because a column label's note is
 * a subtitle rather than a body of text.
 *
 * Deliberately a fixed toolbar of toggles rather than a WYSIWYG editor: the ask
 * is bold / italic / underline / colours / a leading icon, and a general text
 * editor would reintroduce exactly the markup lib/richText exists to avoid.
 */
export function RichTextEditor({
  value, note, style, noteStyle, dual = false, onChange, onClose, label,
}: {
  value: string;
  note: string;
  style: RichTextStyle;
  noteStyle?: RichTextStyle;
  dual?: boolean;
  onChange: (next: AnnotationDraft) => void;
  onClose: () => void;
  label: string;
}) {
  const [v, setV] = useState(value);
  const [n, setN] = useState(note);
  const [s, setS] = useState<RichTextStyle>(normStyle(style));
  const [ns, setNs] = useState<RichTextStyle>(normStyle(noteStyle));
  const ref = useRef<HTMLDivElement>(null);

  const commit = () => onChange({ value: v, note: n, style: s, noteStyle: ns });

  /* Click-away commits rather than discards. Losing someone's typed note because
     they clicked the map would be hostile. */
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) { commit(); onClose(); }
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { commit(); onClose(); } };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  });

  return (
    <div
      ref={ref}
      className="w-[252px] rounded-[9px] border border-line2 bg-panel p-2 shadow-panel"
      onClick={e => e.stopPropagation()}
    >
      <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[.08em] text-dim2">{label}</div>

      <input
        autoFocus
        value={v}
        onChange={e => setV(e.target.value)}
        placeholder="ชื่อ"
        className="mb-1 w-full rounded-[6px] border border-line2 bg-bg px-2 py-1 text-[12px] outline-none focus:border-accent"
      />
/* A textarea, not an input. A note is prose — it wraps to several lines, and
         a single-line field forces the user to write "see above" or scroll a
         one-line box sideways. Grows to a few rows rather than a fixed height
         so a long note is readable while editing. */
      <textarea
        value={n}
        onChange={e => setN(e.target.value)}
        placeholder="หมายเหตุ"
        rows={2}
        className="mb-1.5 w-full resize-y rounded-[6px] border border-line2 bg-bg px-2 py-1 text-[11px] leading-snug outline-none focus:border-accent"
      />

      <div className="mb-1 text-[9.5px] font-semibold uppercase tracking-[.08em] text-dim2">ชื่อ</div>
      <StyleRow s={s} onChange={setS} compact={false} />

      {dual && (
        <>
          <div className="mb-1 mt-2 text-[9.5px] font-semibold uppercase tracking-[.08em] text-dim2">หมายเหตุ</div>
          <StyleRow s={ns} onChange={setNs} compact={false} />
        </>
      )}

      {/* Live preview of both fields, so a choice is visible before saving. */}
      <div className="mb-2 rounded-[6px] border border-line2 bg-bg px-2 py-1.5 text-[11.5px]">
        <RichText value={v || 'ตัวอย่าง'} style={s} note={n || undefined} noteStyle={ns} />
      </div>

      <div className="flex justify-end gap-1.5">
        <button
          type="button"
          className="rounded-[6px] border border-line2 px-2 py-1 text-[11px] text-dim hover:bg-panel2"
          onClick={() => { onChange({ value, note, style: normStyle(style), noteStyle: normStyle(noteStyle) }); onClose(); }}
        >
          ยกเลิก
        </button>
        <button
          type="button"
          className="rounded-[6px] bg-accent px-2.5 py-1 text-[11px] font-semibold text-accent-ink"
          onClick={() => { commit(); onClose(); }}
        >
          บันทึก
        </button>
      </div>
    </div>
  );
}

/** Compact trigger button that opens the editor, with a dot when styled. */
export function RichTextTrigger({
  onClick, hasStyle, title,
}: {
  onClick: () => void;
  hasStyle: boolean;
  title: string;
}) {
  return (
    <button
      {...useTipProps(title)}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`grid size-[19px] shrink-0 place-items-center rounded-[4px] text-[10px] transition hover:bg-panel2 ${
        hasStyle ? 'text-accent' : 'text-dim2'
      }`}
    >
      {hasStyle ? '●' : '✎'}
    </button>
  );
}
