/* markText.ts — the inline markup the annotation editor writes.
 *
 * The bottom-table editor for ชื่อกำกับ / หมายเหตุกำกับ is a markup editor: the
 * toolbar inserts `<b>bold</b>`-style tags the user can see in the textarea.
 * The value stays inert TEXT — nothing here is ever handed to a browser as
 * HTML. parseMark() rewrites the markup into the same styled-segment shape
 * RichText draws from, so a tag can only ever mean "colour this span", and an
 * unknown tag or an unclosed tag degrades to literal text rather than breaking
 * the render.
 *
 * Tags: <b> · <i> · <u> · <bg=#hex> · <fg=#hex> and their closers. Emoji are
 * plain characters, no tag.
 */
import type { CSSProperties } from 'react';
import { isColor, styleToCss, type RichTextStyle } from './richText';

export interface MarkSpan {
  text: string;
  style: RichTextStyle;
  css: CSSProperties;
}

export type MarkFlag = 'b' | 'i' | 'u' | 'bg' | 'fg';

const TAG_RE = /<(\/?)(b|i|u|bg|fg)(?:=(#(?:[0-9a-fA-F]{3,8})))?>/g;

/** Markup → styled spans, merged on top of the column's whole-field style. */
export function parseMark(src: string, base: RichTextStyle = {}): MarkSpan[] {
  const out: MarkSpan[] = [];
  const undo: Array<Partial<RichTextStyle>> = [];
  let st: RichTextStyle = { ...base };
  let text = '';
  const flush = () => {
    if (text) out.push({ text, style: { ...st }, css: styleToCss(st) });
    text = '';
  };
  let last = 0;
  for (const m of src.matchAll(TAG_RE)) {
    text += src.slice(last, m.index);
    last = m.index + m[0].length;
    const [full, close, flag, hex] = [m[0], m[1], m[2] as MarkFlag, m[3]];
    if (!close) {
      /* Flush FIRST: the buffered text belongs to the style in effect before
         the tag opened, not after. */
      flush();
      if (flag === 'b' || flag === 'i' || flag === 'u') {
        undo.push({ [flag]: false });
        st = { ...st, [flag]: true };
      } else if ((flag === 'bg' || flag === 'fg') && isColor(hex)) {
        undo.push({ [flag]: st[flag] ?? '' });
        st = { ...st, [flag]: hex };
      } else {
        /* e.g. <bg=#zzz> — not a colour, so not one of ours: literal text.
           It joins the pending run and inherits whatever style is live. */
        text += full;
      }
    } else {
      const prev = undo.pop();
      if (prev) {
        flush();
        st = { ...st, ...prev };
        for (const k of Object.keys(prev)) {
          const key = k as keyof RichTextStyle;
          if (st[key] === false || st[key] === '') delete st[key];
        }
      } else {
        text += full; /* stray closer: text */
      }
    }
  }
  text += src.slice(last);
  flush();
  return out;
}

/** Markup → plain text, for the one place that must not carry it: map labels.
 *  Strips every tag-shaped token for our five names, whatever the value — a
 *  hand-tweaked <bg=#zzz> is still markup noise, not prose. */
export const stripMark = (s: string): string =>
  s.replace(/<\/?(?:b|i|u|bg|fg)(?:=[^\s>/]*)?>/g, '');

/** True when the value carries any of our tags. */
export const hasMark = (s: string): boolean => TAG_RE.test(s);
