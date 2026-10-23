import { test, expect } from 'bun:test';
import { hasMark, parseMark, stripMark } from '../src/lib/markText.ts';

/* The bottom-table editor stores markup in the text — <b>, <i>, <u>,
   <bg=#hex>, <fg=#hex>. These pin the parser: tags render as styled spans,
   everything else (unknown tags, stray closers, angle brackets in general)
   stays literal text, because the value is inert TEXT, never HTML. */

const txt = (spans: { text: string }[]) => spans.map(s => s.text).join('');

test('plain text parses as a single unstyled span', () => {
  const spans = parseMark('โคกสนวน');
  expect(spans).toHaveLength(1);
  expect(spans[0]!.text).toBe('โคกสนวน');
});

test('bold / italic / underline wrap spans', () => {
  const spans = parseMark('<b>สำคัญ</b> ปกติ');
  expect(txt(spans)).toBe('สำคัญ ปกติ');
  expect(spans[0]!.style.b).toBe(true);
  expect(spans[1]!.style.b).toBeUndefined();
});

test('styles nest and restore exactly', () => {
  const spans = parseMark('<b>หนา<u>ขีด</u>หนา</b>');
  expect(spans[0]!.style.b).toBe(true);
  expect(spans[0]!.style.u).toBeUndefined();
  expect(spans[1]!.style).toMatchObject({ b: true, u: true });
  expect(spans[2]!.style).toMatchObject({ b: true });
  expect(spans[2]!.style.u).toBeUndefined();
});

test('colour tags carry hex and restore on close', () => {
  const spans = parseMark('<fg=#e60000>แดง</fg>เข้ม');
  expect(spans[0]!.style.fg).toBe('#e60000');
  expect(spans[1]!.style.fg).toBeUndefined();
});

test('a colour tag with a bad value renders literally', () => {
  const spans = parseMark('<bg=#zzz>ข้อความ</bg>');
  expect(txt(spans)).toBe('<bg=#zzz>ข้อความ</bg>');
});

test('a stray closer renders literally and eats nothing', () => {
  const spans = parseMark('เปิด</b>');
  expect(txt(spans)).toBe('เปิด</b>');
});

test('an unclosed tag runs to the end of the string', () => {
  const spans = parseMark('หนา<u>และขีด');
  expect(spans[0]!.style).toMatchObject({});
  expect(spans[1]!.style.u).toBe(true);
});

test('whole-field style is the base the tags sit on', () => {
  const spans = parseMark('หนา', { b: true });
  expect(spans[0]!.style.b).toBe(true);
});

test('stripMark removes every syntactic tag, valid or not', () => {
  expect(stripMark('<b>ก</b><fg=#e60000>ข</fg>')).toBe('กข');
  expect(stripMark('<bg=#zzz>ค</bg>')).toBe('ค');
});

test('hasMark detects our tags only', () => {
  expect(hasMark('<b>x</b>')).toBe(true);
  expect(hasMark('a < b')).toBe(false);
});
