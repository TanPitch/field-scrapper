import { Pentagon, Scan, Trash2 } from 'lucide-react';
import { useTipProps } from '../ui/Tip';
import { labelPos, startArea, cancelDraw, clearAreas, deleteArea, syncDraws, toggleArea } from '../../map/drawEngine';
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
      <div className="mb-2.5 flex gap-2">
        <button className={`${btn} flex-1 justify-center ${mode === 'area' ? 'border-accent text-accent' : ''}`} onClick={() => (mode === 'area' ? cancelDraw() : startArea())}>
          <Scan size={14} />{mode === 'area' ? 'ยกเลิก' : 'วาดพื้นที่'}
        </button>
      </div>
      <DetSub first>พื้นที่ ({areas.length})</DetSub>
      {areas.length ? areas.map(a => {
        return (
          <div key={a.id} className={drowCls()} onClick={e => { if (!(e.target as HTMLElement).closest('button,input,span[data-badge]')) flyToArea(a); }}>
            <span data-badge><LpBadge red>A{a.no}</LpBadge></span>
            <Switch checked={a.enabled} {...useTipProps('รวมพื้นที่นี้ในการกรอง (เปิดขอบและป้ายด้วย)')} onChange={v => toggleArea(a.id, v)} />
            <Pentagon size={14} className="flex-none text-danger" />
            <span>พื้นที่ A{a.no}</span>
            <button className={`${rowIcon} ml-auto`} {...useTipProps('ลบพื้นที่นี้')} onClick={() => deleteArea(a.id)}><Trash2 size={13} /></button>
          </div>
        );
      }) : <div className={emptyNote}>ยังไม่มีพื้นที่ — กด "วาดพื้นที่"</div>}
      {areas.length > 0 && <button className={`${btn} mt-1.5 w-full justify-center`} onClick={clearAreas}><Trash2 size={14} />ล้างพื้นที่ทั้งหมด</button>}
      <div className={`${frow} mt-2 !border-b-0`}>
        <span className={fl}>แสดงแท็ก A บนพื้นที่</span>
        <Switch checked={areaTagsOn} onChange={v => { patchApp({ areaTagsOn: v }); syncDraws(); }} />
      </div>
      <div className={`${frow} mt-2 !border-b-0`}>
        <span className={fl}>แสดงเฉพาะจุดในพื้นที่</span>
        <Switch checked={restrict} onChange={v => patchApp(v ? { restrict: true } : { restrict: false, override: false })} />
      </div>
    </VPad>
  );
}
