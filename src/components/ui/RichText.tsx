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
  value, style, note, noteStyle, className = '', maxLines, runs, noteRuns,
}: {
  value: string | null | undefined;
  style?: RichTextStyle | null;
  note?: string | null;
  noteStyle?: RichTextStyle | null;
  className?: string;
  maxLines?: number;
  /** Per-range overrides so a word can be emphasised inside a whole field. */
  runs?: StyleRun[] | null;
  noteRuns?: StyleRun[] | null;
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
      {segments(text, runs ?? undefined, s).map((seg, i) => (
        <span key={i} style={styleToCss(seg.style)}>{seg.text}</span>
      ))}
      {note ? (
        <span className="ml-1.5 text-[10px] text-dim2">
          {segments(note, noteRuns ?? undefined, ns).map((seg, i) => (
            <span key={i} style={styleToCss(seg.style)}>{seg.text}</span>
          ))}
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

/**
 * A styled span inside a field.
 *
 * Offsets are character positions into the field's plain text, half-open
 * [from, to). Storing style per range rather than per field is what lets
 * someone bold one word inside a note instead of the whole note.
 *
 * Ranges are advisory, not authoritative: the text is the truth. An offset past
 * the end of the text (the user typed after styling) is dropped at render time
 * rather than throwing, because losing a styled word is a far smaller failure
 * than an editor that refuses to render the annotation at all.
 */
export interface StyleRun {
  from: number;
  to: number;
  style: RichTextStyle;
}

export interface AnnotationDraft {
  value: string;
  note: string;
  style: RichTextStyle;
  noteStyle: RichTextStyle;
  valueRuns?: StyleRun[];
  noteRuns?: StyleRun[];
}

/**
 * Split `text` into styled segments.
 *
 * Later runs win where they overlap an earlier one, since the most recent
 * thing the user chose is the one they expect to see. Segments are emitted in
 * order and never overlap, so the concatenation always reproduces `text`
 * exactly — important, because this is where a bug would silently eat text.
 */
export function segments(
  text: string,
  runs: StyleRun[] | undefined,
  base: RichTextStyle,
): { text: string; style: RichTextStyle }[] {
  if (!runs?.length) return [{ text, style: base }];

  /* Boundaries first, then one pass marking which run owns each cell. */
  const bounds = new Set<number>([0, text.length]);
  const clean = runs.filter(r => r.to > r.from && r.from >= 0);
  for (const r of clean) { bounds.add(Math.max(0, Math.min(r.from, text.length))); bounds.add(Math.max(0, Math.min(r.to, text.length))); }
  const cuts = [...bounds].sort((a, b) => a - b);

  const out: { text: string; style: RichTextStyle }[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const from = cuts[i], to = cuts[i + 1];
    if (to <= from) continue;
    let st = base;
    for (const r of clean) {
      if (r.from <= from && r.to >= to) st = { ...st, ...r.style };
    }
    out.push({ text: text.slice(from, to), style: st });
  }
  return out.length ? out : [{ text, style: base }];
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
  runs, noteRuns,
}: {
  value: string;
  note: string;
  style: RichTextStyle;
  noteStyle?: RichTextStyle;
  dual?: boolean;
  runs?: StyleRun[];
  noteRuns?: StyleRun[];
  onChange: (next: AnnotationDraft) => void;
  onClose: () => void;
  label: string;
}) {
  const [v, setV] = useState(value);
  const [n, setN] = useState(note);
  const [s, setS] = useState<RichTextStyle>(normStyle(style));
  const [ns, setNs] = useState<RichTextStyle>(normStyle(noteStyle));
  const [vr, setVr] = useState<StyleRun[]>(runs ?? []);
  const [nr, setNr] = useState<StyleRun[]>(noteRuns ?? []);
  const ref = useRef<HTMLDivElement>(null);

  /* Which field the user last clicked into. A style click applies to the
     selection there; with no selection it applies to the whole field, which is
     what a click on an empty field means. */
  const [focus, setFocus] = useState<'name' | 'note'>('name');
  const selRef = useRef<{ from: number; to: number } | null>(null);

  const capture = (field: 'name' | 'note', el: HTMLInputElement | HTMLTextAreaElement) => {
    setFocus(field);
    const a = el.selectionStart, b = el.selectionEnd;
    /* A collapsed caret is not a selection. Storing it would create a
       zero-length run that the renderer drops anyway. */
    selRef.current = a == null || b == null || a === b ? null : { from: a, to: b };
  };

  /**
   * Apply a style to the current selection, or to the whole field.
   *
   * Selecting one word and pressing bold should bold that word. Applying to the
   * entire field regardless would make per-range styling impossible to reach.
   * Ranges are additive rather than replaced, so restyling part of a field does
   * not discard styling elsewhere in it.
   */
  const applyToSelection = (field: 'name' | 'note', patch: RichTextStyle) => {
    const sel = selRef.current;
    if (field === 'note') {
      if (!sel) { setNs({ ...ns, ...patch }); return; }
      setNr([...nr, { from: sel.from, to: sel.to, style: patch }]);
      return;
    }
    if (!sel) { setS({ ...s, ...patch }); return; }
    setVr([...vr, { from: sel.from, to: sel.to, style: patch }]);
  };

  const commit = () => onChange({ value: v, note: n, style: s, noteStyle: ns, valueRuns: vr, noteRuns: nr });

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
        onChange={e => { setV(e.target.value); capture('name', e.target); }}
        onSelect={e => capture('name', e.currentTarget)}
        onKeyUp={e => { if (e.shiftKey || e.key.startsWith('Arrow')) capture('name', e.currentTarget); }}
        placeholder="ชื่อ"
        className="mb-1 w-full rounded-[6px] border border-line2 bg-bg px-2 py-1 text-[12px] outline-none focus:border-accent"
      />
      {/* A textarea, not an input. A note is prose — it wraps to several lines,
          and a single-line field forces "see above" or sideways scrolling. */}
      <textarea
        value={n}
        onChange={e => { setN(e.target.value); capture('note', e.target); }}
        onSelect={e => capture('note', e.currentTarget)}
        onKeyUp={e => { if (e.shiftKey || e.key.startsWith('Arrow')) capture('note', e.currentTarget); }}
        placeholder="หมายเหตุ"
        rows={2}
        className="mb-1.5 w-full resize-y rounded-[6px] border border-line2 bg-bg px-2 py-1 text-[11px] leading-snug outline-none focus:border-accent"
      />

      <div className="mb-1 text-[9.5px] font-semibold uppercase tracking-[.08em] text-dim2">
        ชื่อ{selRef.current ? ' · ใช้กับข้อความที่เลือก' : ''}
      </div>
      {/* The toolbar reflects the focused field, and its buttons write through
          applyToSelection so a selection is styled instead of the whole field. */}
      <StyleRow
        s={focus === 'name' ? s : ns}
        onChange={patch => (focus === 'name' ? applyToSelection('name', patch) : applyToSelection('note', patch))}
        compact={false}
      />

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
