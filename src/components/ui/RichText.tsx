import type { CSSProperties } from 'react';
import { isColor, normStyle, styleToCss, type RichTextStyle } from '../../lib/richText';
import { parseMark } from '../../lib/markText';

/**
 * Renders a user-authored label and/or note styled.
 *
 * Styling has two layers, both kept: the whole-field `nameStyle`/`noteStyle`
 * flags (legacy and alive — they are what the API stores per column), and the
 * inline markup the bottom-table editor writes — `<b>bold</b>`,
 * `<bg=#hex>…</bg>` and friends — which lib/markText parses into spans.
 * Values without tags parse as one plain span, so old data renders unchanged.
 *
 * Everything renders as React spans, never as HTML: a stored string is inert.
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

  const spans = (src: string, base: RichTextStyle): { text: string; css: CSSProperties }[] =>
    parseMark(src, base).map(sp => ({ text: sp.text, css: sp.css }));

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
      {spans(text, s).map((seg, i) => (
        <span key={i} style={seg.css}>{seg.text}</span>
      ))}
      {note ? (
        <span className="ml-1.5 text-[10px] text-dim2">
          {spans(note, ns).map((seg, i) => (
            <span key={i} style={seg.css}>{seg.text}</span>
          ))}
        </span>
      ) : null}
    </span>
  );
}
