/* richText.ts — the one styling shape for user-authored labels and notes.
 *
 * Shared by all three places the user can annotate: a table column's name and
 * note, a drawing layer, and a display area. One type means one editor, one
 * renderer and one set of rules, instead of three that drift.
 *
 * Deliberately NOT HTML. A note is free text a user typed, and it ends up in
 * another user's browser; storing markup would make stored XSS a matter of
 * time. So the style is a flat set of flags and colours, the server validates
 * it against the same shape (server/users.js normStyle), and this module is the
 * only thing that turns it into CSS.
 */
import type { CSSProperties } from 'react';

export interface RichTextStyle {
  /** bold / italic / underline */
  b?: boolean;
  i?: boolean;
  u?: boolean;
  /** background and text colour — CSS colours only */
  bg?: string;
  fg?: string;
  /** leading emoji or shape, up to 4 characters */
  badge?: string;
}

export const EMPTY_STYLE: RichTextStyle = {};

/* ------------------------------------------------------------------ colour */

/**
 * Only accept a colour we are willing to put in a style attribute. A value that
 * is not a colour is dropped rather than escaped: there is no legitimate reason
 * for `background:url(...)` to arrive here, so accepting it would only ever be
 * an attack.
 */
const COLOR = /^#[0-9a-fA-F]{3,8}$|^[a-zA-Z]{3,20}$|^rgba?\(\s*[\d.\s,%]+\)$/;

export const isColor = (v: unknown): v is string =>
  typeof v === 'string' && COLOR.test(v.trim());

/* ------------------------------------------------------------------- css */

/**
 * Flags → inline style. Badge is excluded: it is content, not styling, and the
 * renderer emits it as a separate span.
 */
export function styleToCss(s: RichTextStyle | null | undefined): CSSProperties {
  if (!s) return {};
  const css: CSSProperties = {};
  if (s.b) css.fontWeight = 700;
  if (s.i) css.fontStyle = 'italic';
  if (s.u) css.textDecoration = 'underline';
  /* textDecoration collapses when underline and line-through are both set, so
     keep an explicit underline rather than letting the browser pick. */
  else if (s.u === false) css.textDecoration = 'none';
  if (isColor(s.bg)) css.backgroundColor = s.bg;
  if (isColor(s.fg)) css.color = s.bg ? undefined : s.fg;
  return css;
}

/** Normalise anything into a valid style. Used on every read, so bad persisted
 *  data degrades to plain text instead of throwing during render. */
export function normStyle(s: unknown): RichTextStyle {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return { ...EMPTY_STYLE };
  const in0 = s as Record<string, unknown>;
  const out: RichTextStyle = {};
  for (const k of ['b', 'i', 'u'] as const) {
    if (k in in0) out[k] = Boolean(in0[k]);
  }
  for (const k of ['bg', 'fg'] as const) {
    if (isColor(in0[k])) out[k] = (in0[k] as string).trim();
  }
  if (typeof in0.badge === 'string') {
    const b = Array.from(in0.badge.trim()).slice(0, 4).join('');
    if (b) out.badge = b;
  }
  return out;
}

/** True when nothing is styled — lets callers skip the wrapper entirely. */
export const isPlain = (s: RichTextStyle | null | undefined): boolean =>
  !s || Object.keys(normStyle(s)).length === 0;

/* --------------------------------------------------------------- helpers */

/** The shapes offered in the badge picker. Kept short so they fit a label cell. */
export const BADGE_CHOICES = ['●', '▲', '■', '◆', '★', '⚑', '⚠', '✓', '✕', '📌', '🏷', '💰'];

/**
 * The full set shown in the picker panel. Shapes first (they read at any size
 * and never render as a tofu box), then emoji.
 *
 * Only glyphs that are safe to store as text and render identically wherever the
 * label is drawn: no variation selectors, no ZWJ sequences, no flags, which
 * render as two letters on Windows.
 */
export const ICON_CHOICES = [
  '●', '○', '■', '□', '▲', '▼', '◆', '◇', '★', '☆', '⚑', '⚠', '✓', '✕', '§', '¶',
  '📌', '🏷', '💰', '📍', '⚖', '🏠', '🌾', '🌳', '💧', '⚡', '🔧', '🚩', '⭐', '🔴', '🟡', '🟢',
  '📝', '📌', '🔑', '📐', '🧭', '🪧', '🚧', '🔥', '❗', '❓', '➜', '✱',
] as const;

export const PRESET_COLORS = [
  '#B8F13F', '#F5F6F4', '#E5484D', '#FF9F43', '#FFD93D', '#3DDAD7',
  '#4C9AFF', '#B18CFF', '#8B9096', '#5C5247', '#22371F', '#0D0F0D',
];

/** Flatten a style into the wire shape the API stores. */
export const toWire = (s: RichTextStyle): Record<string, unknown> =>
  ({ ...normStyle(s) } as Record<string, unknown>);
