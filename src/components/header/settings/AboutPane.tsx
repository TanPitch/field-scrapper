import { RotateCcw } from 'lucide-react';
import { useMemo } from 'react';
/* RELEASE_NOTES.md was moved to docs/ on 2026-10-23 — the import path follows. */
import RELEASE_NOTES from '../../../../docs/RELEASE_NOTES.md?raw';
import { resetAll } from '../../../store/actions';
import {
  changelogVersion,
  parseChangelog,
  parseInline,
} from '../../../lib/changelog';
import { btn, setSec } from '../../ui/styles';

/* เกี่ยวกับ - the release notes inlined from RELEASE_NOTES.md. */
/** RELEASE_NOTES.md inline markup: **bold** and `code`. */
function Md({ text }: { text: string }): React.ReactNode {
  return <>{parseInline(text).map((c, i) =>
    c.t === 'b' ? <b key={i} className="font-semibold text-ink">{c.v}</b>
      : c.t === 'c' ? <code key={i} className="rounded bg-panel2 px-[3px] py-px font-display text-[10.5px] text-accent">{c.v}</code>
        : <span key={i}>{c.v}</span>,
  )}</>;
}
/** RELEASE_NOTES.md, inlined at build time and rendered as a scrollable list. */
function Changelog() {
  const groups = useMemo(() => parseChangelog(RELEASE_NOTES), []);
  return (
    <div className="my-2 max-h-[260px] overflow-y-auto overscroll-contain rounded-[10px] border border-line px-3 pb-2 text-[11.5px] leading-[1.65] text-dim">
      {groups.map(g => (
        <div key={g.version} className="mb-2.5 last:mb-0">
          <div className="sticky top-0 z-[1] mb-1.5 bg-panel px-3 pt-4 pb-2 font-display text-[11px] font-semibold text-ink">
            {changelogVersion(g.version) === g.version ? g.version : `${changelogVersion(g.version)} — ${g.version.slice(changelogVersion(g.version).length + 2).trim()}`}
          </div>
          {g.sections.map((s, i) => (
            <div key={i} className="mb-1.5 last:mb-0">
              {s.heading && <div className="mb-0.5 pl-1 text-[10.5px] font-semibold text-dim2">{s.heading}</div>}
              <ul className="m-0 list-none space-y-[3px] pl-3.5">
                {s.items.map((it, j) => (
                  <li key={j} className="relative before:absolute before:-left-2.5 before:top-[.55em] before:size-[3px] before:rounded-full before:bg-dim2 before:content-['']">
                    <Md text={it} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
export function AboutPane() {
  return (
    <>
      <div className={`${setSec} !mt-0.5`}>บันทึกการเปลี่ยนแปลง</div>
      <Changelog />
      {/* <div className={setSec}>ข้อมูลจำลอง</div>
      <div className={frow}><span className={fl}>แปลงที่ดินทั้งหมด</span><b className="text-xs font-semibold">{ALL_PARCELS.length.toLocaleString('th-TH')} แปลง</b></div>
      <div className={frow}><span className={fl}>จังหวัด</span><b className="text-xs font-semibold">{PROVINCES.length} จังหวัด</b></div> */}
      <button className={`${btn} mt-3`} onClick={resetAll}><RotateCcw size={14} />รีเซ็ตตัวกรอง คอลัมน์ และการปักหมุด</button>
    </>
  );
}
