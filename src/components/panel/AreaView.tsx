import { MoreHorizontal, Pentagon, Scan, Tag, Trash2 } from 'lucide-react';
import { useTipProps } from '../ui/Tip';
import { useState } from 'react';
import { labelPos, startArea, cancelDraw, clearAreas, deleteArea, syncDraws, toggleArea } from '../../map/drawEngine';
import { getMap } from '../../map/mapRef';
import { hasColumnOverride, useAnnotations } from '../../store/useAnnotations';
import { patchApp, useApp } from '../../store/useApp';
import type { FilterArea } from '../../types';
import { btn, fl, frow } from '../ui/styles';
import { RichText } from '../ui/RichText';
import { AnnotInputs } from '../ui/AnnotInputs';
import { Switch } from '../ui/Switch';
import { DetSub, LpBadge, VPad, drowCls, emptyNote, rowIcon } from './shared';

function flyToArea(a: FilterArea): void {
  const map = getMap(); if (!map) return;
  map.flyTo({ center: labelPos({ type: 'poly', coords: a.coords }), zoom: Math.max(map.getZoom(), 14.5), duration: 850 });
}

/** One display area, annotatable exactly like a drawing layer. */
function AreaRow({ a }: { a: FilterArea }) {
  const [annotating, setAnnotating] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const setLayer = useAnnotations(s => s.setLayer);
  const annot = useAnnotations(s => s.layers[`area-${a.id}`]);
  /* "พื้นที่ A3" is the fallback, so an unannotated area reads as it always did. */
  const shownName = annot?.name?.trim() || `พื้นที่ A${a.no}`;

  return (
    <div className="relative">
      <div className={drowCls()} onClick={e => { if (!(e.target as HTMLElement).closest('button,input,span[data-badge]')) flyToArea(a); }}>
        <span data-badge><LpBadge red>A{a.no}</LpBadge></span>
        <Switch checked={a.enabled} {...useTipProps('รวมพื้นที่นี้ในการกรอง (เปิดขอบและป้ายด้วย)')} onChange={v => toggleArea(a.id, v)} />
        <Pentagon size={14} className="flex-none text-danger" />
        <span className="flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap">
          <RichText value={shownName} style={annot?.nameStyle ?? annot?.style} note={annot?.note ?? undefined} noteStyle={annot?.noteStyle} className="min-w-0 overflow-hidden text-ellipsis" />
        </span>
        <button
          className={`${rowIcon} ml-auto ${menuOpen || hasColumnOverride(annot) ? 'text-accent' : ''}`}
          {...useTipProps('ตั้งชื่อ · ลบพื้นที่')}
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
              className="grid size-[26px] place-items-center rounded-[5px] text-dim hover:bg-panel2 hover:text-[#FF8B7D]"
              {...useTipProps('ลบพื้นที่นี้')}
              onClick={() => { deleteArea(a.id); setMenuOpen(false); }}
            >
              <Trash2 size={13} />
            </button>
          </div>
        )}
        <button className={rowIcon} {...useTipProps('ลบพื้นที่นี้')} onClick={() => deleteArea(a.id)}><Trash2 size={13} /></button>
      </div>

      {annotating && (
        <div className="absolute left-1.5 top-full z-[98] mt-0.5" onClick={e => e.stopPropagation()}>
          <AnnotInputs
            label={`พื้นที่ A${a.no}`}
            name={annot?.name ?? ''}
            note={annot?.note ?? ''}
            /* Namespaced by kind so an area and a drawing can share an id number
               without overwriting each other's annotation. */
            onDone={(name, note) =>
              setLayer(`area-${a.id}`, name.trim() || note.trim()
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

export function AreaView() {
  const areas = useApp(s => s.areas);
  const mode = useApp(s => s.drawMode);
  const restrict = useApp(s => s.restrict);
  const areaTagsOn = useApp(s => s.areaTagsOn);
  return (
    <VPad>
      <div className="mb-2.5 flex gap-2">
        <button className={`${btn} flex-1 justify-center ${mode === 'area' ? 'border-accent text-accent' : ''}`} onClick={() => (mode === 'area' ? cancelDraw() : startArea())}>
          <Scan size={14} />{mode === 'area' ? 'ยกเลิก' : 'วาดพื้นที่'}
        </button>
      </div>
      <DetSub first>พื้นที่ ({areas.length})</DetSub>
      {areas.length ? areas.map(a => <AreaRow key={a.id} a={a} />) : <div className={emptyNote}>ยังไม่มีพื้นที่ — กด "วาดพื้นที่"</div>}
      {areas.length > 0 && <button className={`${btn} mt-1.5 w-full justify-center`} onClick={clearAreas}><Trash2 size={14} />ล้างพื้นที่ทั้งหมด</button>}
      <div className={`${frow} mt-2 !border-b-0`}>
        <span className={fl}>แสดงแท็ก A บนพื้นที่</span>
        <Switch checked={areaTagsOn} onChange={v => { patchApp({ areaTagsOn: v }); syncDraws(); }} />
      </div>
      <div className={`${frow} mt-2 !border-b-0`}>
        <span className={fl}>แสดงเฉพาะจุดในพื้นที่</span>
        <Switch checked={restrict} onChange={v => patchApp(v ? { restrict: true } : { restrict: false, override: false })} />
      </div>
      <div className="mt-2 text-[10.5px] leading-[1.6] text-dim2">
        ปุ่ม <Tag size={9} className="inline" /> ตั้งชื่อ หมายเหตุ และรูปแบบตัวอักษรของพื้นที่นี้ได้ — เหมือนกับชั้นข้อมูลที่วาด
      </div>
    </VPad>
  );
}
