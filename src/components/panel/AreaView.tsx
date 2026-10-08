import { Pentagon, Scan, Trash2 } from 'lucide-react';
import { useTipProps } from '../ui/Tip';
import { fmtDist, fmtRaiFromM2 } from '../../lib/format';
import { closeRing, pathLenM, ringAreaM2 } from '../../lib/geo';
import { cancelDraw, clearAreas, deleteArea, labelPos, startArea, syncDraws, toggleArea } from '../../map/drawEngine';
import { getMap } from '../../map/mapRef';
import { patchApp, useApp } from '../../store/useApp';
import type { FilterArea } from '../../types';
import { btn, fl, frow } from '../ui/styles';
import { Switch } from '../ui/Switch';
import { DetSub, LpBadge, VPad, drowCls, emptyNote, rowIcon } from './shared';

function flyToArea(a: FilterArea): void {
  const map = getMap(); if (!map) return;
  map.flyTo({ center: labelPos({ type: 'poly', coords: a.coords }), zoom: Math.max(map.getZoom(), 14.5), duration: 850 });
}

export function AreaView() {
  const areas = useApp(s => s.areas);
  const mode = useApp(s => s.drawMode);
  const restrict = useApp(s => s.restrict);
  const areaTagsOn = useApp(s => s.areaTagsOn);
  return (
    <VPad>
      <div className="sticky top-0 z-[2] -mx-3.5 -mt-3 mb-2.5 border-b border-line bg-panel px-3.5 py-[11px] text-xs text-dim">
        พื้นที่กรองจุด — วาดเป็นรูป "พื้นที่" เท่านั้น · ขอบและป้าย A1, A2… แสดงบนแผนที่เสมอ (สวิตช์ปิด = ซ่อนขอบและป้ายด้วย)
      </div>
      <div className="mb-2.5 flex gap-2">
        <button className={`${btn} flex-1 justify-center ${mode === 'area' ? 'border-accent text-accent' : ''}`} onClick={() => (mode === 'area' ? cancelDraw() : startArea())}>
          <Scan size={14} />{mode === 'area' ? 'ยกเลิกการวาดพื้นที่' : 'วาดพื้นที่กรอง'}
        </button>
      </div>
      <DetSub first>พื้นที่กรอง ({areas.length}) — สวิตช์ = ใช้/ไม่ใช้ในการกรอง · คลิกแถวเพื่อบินไปดู</DetSub>
      {areas.length ? areas.map(a => {
        const ring = closeRing(a.coords);
        return (
          <div key={a.id} className={drowCls()} onClick={e => { if (!(e.target as HTMLElement).closest('button,input,span[data-badge]')) flyToArea(a); }}>
            <span data-badge><LpBadge red>A{a.no}</LpBadge></span>
            <Switch checked={a.enabled} {...useTipProps('รวมพื้นที่นี้ในการกรอง (เปิดขอบและป้ายด้วย)')} onChange={v => toggleArea(a.id, v)} />
            <Pentagon size={14} className="flex-none text-danger" />
            <span>พื้นที่ A{a.no}</span>
            <span className="min-w-0 flex-1 text-right text-[10px] leading-normal text-dim">
              <span className="block overflow-hidden text-ellipsis whitespace-nowrap">{fmtDist(pathLenM(ring))}</span>
              <span className="block overflow-hidden text-ellipsis whitespace-nowrap">≈ {fmtRaiFromM2(ringAreaM2(ring))}</span>
            </span>
            <button className={rowIcon} {...useTipProps('ลบพื้นที่กรองนี้')} onClick={() => deleteArea(a.id)}><Trash2 size={13} /></button>
          </div>
        );
      }) : <div className={emptyNote}>ยังไม่มีพื้นที่กรอง — กด "วาดพื้นที่กรอง" แล้วคลิกวางจุดบนแผนที่ (เส้นประสองเส้นจากจุดแรก/จุดสุดท้ายถึงเคอร์เซอร์คือตัวอย่างก่อนวาง)</div>}
      {areas.length > 0 && <button className={`${btn} mt-1.5 w-full justify-center`} onClick={clearAreas}><Trash2 size={14} />ล้างพื้นที่กรองทั้งหมด</button>}
      <div className={`${frow} mt-2 !border-b-0`}>
        <span className={fl}>แสดงแท็ก A1 / A2 บนพื้นที่กรองจุด</span>
        <Switch checked={areaTagsOn} onChange={v => { patchApp({ areaTagsOn: v }); syncDraws(); }} />
      </div>
      <div className={`${frow} mt-2 !border-b-0`}>
        <span className={fl}>ใช้จุดที่อยู่ในพื้นที่กรองจุดสำหรับกรองจุดบนแผนที่ (แสดงเฉพาะจุดในพื้นที่กรองหากเปิดโหมด restrict)</span>
        <Switch checked={restrict} onChange={v => patchApp(v ? { restrict: true } : { restrict: false, override: false })} />
      </div>
    </VPad>
  );
}
