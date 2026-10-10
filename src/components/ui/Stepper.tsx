import { useEffect, useState } from 'react';
import { useTipProps } from './Tip';

interface StepperProps {
  value: number | null;
  onChange: (v: number | null) => void;
  step: number;
  /** Format with thousands separators. */
  sep?: boolean;
  title?: string;
  placeholder?: string;
  /** Fixed narrow width instead of filling the row. */
  compact?: boolean;
}

const stepBtn = 'grid w-7 flex-none cursor-pointer place-items-center bg-transparent font-display text-sm font-semibold text-dim hover:bg-panel2 hover:text-accent';

/** − [number] × + stepper; empty = null ("all"). */
export function Stepper({ value, onChange, step, sep = false, title, placeholder = 'ทั้งหมด', compact }: StepperProps) {
  const fmt = (v: number | null) => (v == null ? '' : sep ? v.toLocaleString('th-TH') : String(v));
  const [text, setText] = useState(fmt(value));
  useEffect(() => setText(fmt(value)), [value, sep]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = () => {
    const raw = text.replace(/[^\d]/g, '');
    const nv = raw === '' ? null : Number(raw);
    if (nv !== value) onChange(nv);
    setText(fmt(nv));
  };
  const bump = (d: 1 | -1) => {
    const nv = value == null ? (d > 0 ? step : 0) : value + d * step;
    onChange(nv > 0 ? nv : null);
  };

  return (
    <div className={`flex h-7 min-w-0 items-stretch overflow-hidden rounded-lg border border-line2 bg-bg ${compact ? 'w-[104px] flex-none' : 'flex-1'}`}>
      <button type="button" {...useTipProps('ลด')} className={stepBtn} onMouseDown={e => e.preventDefault()} onClick={() => bump(-1)}>−</button>
      <input
        inputMode="numeric"
        {...useTipProps(title)}
        placeholder={placeholder}
        value={text}
        onChange={e => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); }}
        className="min-w-0 flex-1 border-none bg-transparent px-1 text-center font-display text-[11.5px] font-medium text-ink outline-none placeholder:font-sans placeholder:text-dim2"
      />
      {value != null && (
        <button type="button" {...useTipProps('ล้างค่า')} className={stepBtn} onMouseDown={e => e.preventDefault()} onClick={() => onChange(null)}>×</button>
      )}
      <button type="button" {...useTipProps('เพิ่ม')} className={stepBtn} onMouseDown={e => e.preventDefault()} onClick={() => bump(1)}>+</button>
    </div>
  );
}
