import { useEffect, useRef, useState } from 'react';

/**
 * The plain two-field editor — name + note — for the drawing-tools and
 * display-area right panels. No toolbar, no markup: the map and the marker
 * tags draw this text literally, so annotating a drawing stays plain.
 */
export function AnnotInputs({
  label, name, note, onDone, onClose,
}: {
  label: string;
  name: string;
  note: string;
  onDone: (name: string, note: string) => void;
  onClose: () => void;
}) {
  const [n, setN] = useState(name);
  const [t, setT] = useState(note);
  const box = useRef<HTMLDivElement>(null);

  /* Click-away commits rather than discards — losing a typed note to a stray
     click on the map would be hostile. */
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) { onDone(n, t); onClose(); }
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { onDone(n, t); onClose(); } };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  });

  const fld = 'mb-1 w-full rounded-[6px] border border-line2 bg-bg px-2 py-1 text-[12px] outline-none focus:border-accent';

  return (
    <div ref={box} className="w-[236px] rounded-[9px] border border-line2 bg-panel p-2 shadow-panel" onClick={e => e.stopPropagation()}>
      <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[.08em] text-dim2">{label}</div>
      <input
        autoFocus
        value={n}
        onChange={e => setN(e.target.value)}
        placeholder="ชื่อ"
        className={fld}
      />
      <textarea
        value={t}
        onChange={e => setT(e.target.value)}
        placeholder="หมายเหตุ"
        rows={2}
        className={`${fld} resize-y text-[11px] leading-snug`}
      />
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
          onClick={() => { onDone(n, t); onClose(); }}
        >
          บันทึก
        </button>
      </div>
    </div>
  );
}
