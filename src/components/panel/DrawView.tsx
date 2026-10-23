import { Circle, MoreHorizontal, Pencil, PenTool, Pentagon, Spline, Trash2, Tag, type LucideIcon } from 'lucide-react';
import { useTipProps } from '../ui/Tip';
import { useEffect, useRef, useState } from 'react';
import { ACCENT } from '../../data/constants';
import {
  cancelDraw, clearDraws, deleteDraw, labelPos, shapeMetaLines, startDraw, startEdit, stopEdit, updateDraw,
} from '../../map/drawEngine';
import { getMap } from '../../map/mapRef';
import { hasColumnOverride, useAnnotations } from '../../store/useAnnotations';
import { patchApp, useApp } from '../../store/useApp';
import type { DrawShape, DrawTool } from '../../types';
import { ColorButton } from '../ui/ColorButton';
import { RichText } from '../ui/RichText';
import { AnnotInputs } from '../ui/AnnotInputs';
import { Seg } from '../ui/Seg';
import { btn, inp } from '../ui/styles';
import { Switch } from '../ui/Switch';
import { LpBadge, VPad, VSticky, DetSub, ResCap, drowCls, emptyNote, rowIcon } from './shared';

const D_ICON: Record<DrawTool, LucideIcon> = { poly: Pentagon, line: Spline, circle: Circle };

function flyToDraw(d: DrawShape): void {
  const map = getMap(); if (!map) return;
  map.flyTo({ center: d.type === 'circle' ? d.center : labelPos(d), zoom: Math.max(map.getZoom(), 15), duration: 850 });
}

/** Quick rename for when you only want to retype the name. The full name/note/
 *  styling editor is the Tag button — this stays because typing a name is by far
 *  the most common edit and should not require a popover. */
function RenameInput({ d, onDone }: { d: DrawShape; onDone: () => void }) {
  const [v, setV] = useState(d.name);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const commit = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (save && v.trim()) updateDraw(d.id, { name: v.trim() });
    onDone();
  };
  return (
    <input
      ref={ref} value={v} className={`${inp} !min-w-0 !flex-1 !px-1.5 !py-[3px]`}
      onChange={e => setV(e.target.value)} onBlur={() => commit(true)}
      onKeyDown={e => { if (e.key === 'Enter') commit(true); if (e.key === 'Escape') commit(false); }}
    />
  );
}

function DrawRow({ d }: { d: DrawShape }) {
  const editing = useApp(s => s.editingDraw === d.id);
  const [renaming, setRenaming] = useState(false);
  const [annotating, setAnnotating] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const setLayer = useAnnotations(s => s.setLayer);
  const annot = useAnnotations(s => s.layers[String(d.id)]);
  const Icon = D_ICON[d.type];
  const meta = shapeMetaLines(d);
  const color = d.color || ACCENT;
  /* The drawing's own name stays the fallback: an unannotated layer looks
     exactly as it did before this feature existed. */
  const shownName = annot?.name?.trim() || d.name;

  return (
    /* relative wrapper so the editor popover can anchor to this row */
    <div className="relative">
      <div className={drowCls(editing)} onClick={e => { if (!(e.target as HTMLElement).closest('button,input,span[data-badge]')) flyToDraw(d); }}>
        <span data-badge><LpBadge>#{d.no}</LpBadge></span>
        <Switch checked={d.visible} {...useTipProps('แสดง/ซ่อนชั้นนี้')} onChange={v => updateDraw(d.id, { visible: v })} />
        <ColorButton
          {...useTipProps('เปลี่ยนสี')} value={color} onChange={hex => updateDraw(d.id, { color: hex })}
          className="h-[22px] w-[30px] shrink-0 cursor-pointer rounded-md border border-line2 p-0 hover:border-accent" style={{ background: color }}
        />
        <Icon size={15} className="flex-none" style={{ color }} />

        {renaming ? <RenameInput d={d} onDone={() => setRenaming(false)} /> : editing ? (
          <span className="min-w-0 max-w-[110px] cursor-text overflow-hidden text-ellipsis whitespace-nowrap hover:text-accent" {...useTipProps('คลิกเพื่อเปลี่ยนชื่อ')} onClick={() => setRenaming(true)}>
            <RichText value={shownName} style={annot?.style} />
          </span>
        ) : (
        <span className="flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap">
          <RichText value={shownName} style={annot?.nameStyle ?? annot?.style} note={annot?.note ?? undefined} noteStyle={annot?.noteStyle} className="min-w-0 overflow-hidden text-ellipsis opacity-85" />
        </span>
        )}

        <span className="min-w-0 flex-1 text-right text-[10px] leading-normal text-dim">
          {meta.map(m => <span key={m} className="block overflow-hidden text-ellipsis whitespace-nowrap">{m}</span>)}
        </span>

        {/* Three actions, one button. The row is already dense — icon, colour,
            switch, shape, name and metrics — so three more icons read as noise
            and the pencil in particular looks like the primary action when it is
            only one of three equals. */}
        <button
          className={`${rowIcon} ${menuOpen || hasColumnOverride(annot) || editing ? 'text-accent' : ''}`}
          {...useTipProps('ตั้งชื่อ · แก้ไขรูป · ลบรูป')}
          onClick={e => { e.stopPropagation(); setMenuOpen(v => !v); }}
        >
          <MoreHorizontal size={13} />
        </button>

        {menuOpen && (
          <div
            className="absolute right-1.5 top-full z-[99] mt-0.5 flex gap-0.5 rounded-[7px] border border-line2 bg-panel p-1 shadow-panel"
            onClick={e => e.stopPropagation()}
          >
            <button
              className="grid size-[26px] place-items-center rounded-[5px] text-dim hover:bg-panel2 hover:text-accent"
              {...useTipProps('ตั้งชื่อ หมายเหตุ และรูปแบบตัวอักษร')}
              onClick={() => { setAnnotating(true); setMenuOpen(false); }}
            >
              <Tag size={13} />
            </button>
            <button
              className={`grid size-[26px] place-items-center rounded-[5px] hover:bg-panel2 ${editing ? 'text-accent' : 'text-dim hover:text-ink'}`}
              {...useTipProps('แก้ไขรูปนี้')}
              onClick={() => { editing ? stopEdit() : startEdit(d.id); setMenuOpen(false); }}
            >
              <Pencil size={13} />
            </button>
            <button
              className="grid size-[26px] place-items-center rounded-[5px] text-dim hover:bg-panel2 hover:text-[#FF8B7D]"
              {...useTipProps('ลบรูปนี้')}
              onClick={() => { deleteDraw(d.id); setMenuOpen(false); }}
            >
              <Trash2 size={13} />
            </button>
          </div>
        )}
      </div>

      {annotating && (
        <div className="absolute left-1.5 top-full z-[98] mt-0.5" onClick={e => e.stopPropagation()}>
          <AnnotInputs
            label={`ชั้นข้อมูล #${d.no}`}
            name={annot?.name ?? ''}
            note={annot?.note ?? ''}
            /* Plain text only — mark the flag styles through untouched so
               anything styled before the editor became plain still shows. */
            onDone={(name, note) =>
              setLayer(d.id, name.trim() || note.trim()
                ? { name: name.trim() || null, note: note.trim() || null, nameStyle: annot?.nameStyle ?? annot?.style, noteStyle: annot?.noteStyle }
                : null)
            }
            onClose={() => setAnnotating(false)}
          />
        </div>
      )}
    </div>
  );
}

export function DrawView() {
  const draws = useApp(s => s.draws);
  const tool = useApp(s => s.drawTool);
  const mode = useApp(s => s.drawMode);
  return (
    <>
      <VSticky>
        <div className="mb-2 text-xs text-dim">ชั้นข้อมูลที่วาด — กดปุ่มดินสอก่อน แล้วค่อยคลิกชื่อเพื่อเปลี่ยนชื่อ · คลิกแถวเพื่อบินไปดู</div>
        <Seg<DrawTool> items={[['line', 'เส้น'], ['poly', 'พื้นที่'], ['circle', 'วงกลม']]} value={tool} onChange={v => patchApp({ drawTool: v })} />
        <div className="mt-2.5 flex gap-2">
          <button className={`${btn} flex-1 justify-center ${mode === 'draw' ? 'border-accent text-accent' : ''}`} onClick={() => (mode === 'draw' ? cancelDraw() : startDraw())}>
            <PenTool size={14} />{mode === 'draw' ? 'ยกเลิกการวาด' : 'เริ่มวาด'}
          </button>
        </div>
      </VSticky>
      <VPad>
        <DetSub first>รายการชั้นข้อมูล ({draws.length})</DetSub>
        {draws.length ? draws.map(d => <DrawRow key={d.id} d={d} />) : (
          <div className={emptyNote}>ยังไม่มีชั้นข้อมูล — เลือกชนิดแล้วกด "เริ่มวาด" หรือใช้ปุ่มย่อที่แถบเครื่องมือซ้าย</div>
        )}
        {draws.length > 0 && <button className={`${btn} mt-1.5 w-full justify-center`} onClick={clearDraws}><Trash2 size={14} />ล้างชั้นข้อมูลทั้งหมด</button>}
        <ResCap>
          ป้าย #n บนแผนที่ตรงกับหมายเลขชั้นข้อมูล (ลบแล้วเลขเรียงใหม่อัตโนมัติ) · ระยะรายช่วงและหมุดตัวเลขกลมจะซ่อนเมื่อซูมออก
          <div className="mt-1">ปุ่ม <Tag size={9} className="inline" /> ตั้งชื่อ หมายเหตุ และรูปแบบตัวอักษร (ตัวหนา/เอียง/ขีดเส้นใต้ สีพื้น–สีตัวอักษร และสัญลักษณ์นำหน้า)</div>
        </ResCap>
      </VPad>
    </>
  );
}
