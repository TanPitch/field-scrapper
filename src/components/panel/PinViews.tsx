import { Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp, patchApp } from '../../store/useApp';
import { gotoItem } from '../../map/pins';
import { esc } from '../../lib/format';
import { ALL_PARCELS } from '../../data/mockData';
import {
  getDistrictItems, getProvinceItems, getSubdistrictItems, parentsOfDistrict, parentsOfSubdistrict,
  PROPERTY_TYPES, SELLER_AGENCIES,
} from '../../data/searchOptions';
import { onlineSearch } from '../../lib/onlineSearch';
import { getMap } from '../../map/mapRef';
import type { BBox, SearchHit } from '../../types';
import { DateButton } from '../ui/DateButton';
import { Select, type SelectItem } from '../ui/Select';
import { SensorChart } from '../charts/SensorChart';
import { CamScreen, LiveDot } from '../pins/CctvPopup';
import { btnAcc, fl, frow, inp } from '../ui/styles';
import { Switch } from '../ui/Switch';
import { Chip, DetName, DetRows, DetSub, DetTop, Hint, ResCap, VPad } from './shared';
import { numDate } from '../../lib/format';
import { convertShortInput, parseShortNumber, sizeSetsToWah, toggleSizeMode, type SizeValue } from '../../lib/landSize';

export function CctvView() {
  const id = useApp(s => s.pinSel);
  const st = useApp(s => s.cctvList.find(p => p.id === id));
  if (!st) return null;
  return (
    <VPad>
      <DetTop>
        <Chip bg="rgba(255,201,77,.16)" ink="#FFC94D">CCTV</Chip>
        <span className="font-display text-[10.5px] text-dim2">{st.id}</span>
        <LiveDot className="ml-auto" />
      </DetTop>
      <DetName>{st.name}</DetName>
      <div className="mt-2.5"><CamScreen note="วิดีโอ/ภาพสตรีม (โหมดตัวอย่าง)" /></div>
      <DetRows
        className="mt-3"
        rows={[
          ['สถานะ', <span key="s" className="text-accent">ออนไลน์</span>],
          ['พิกัด', `${st.ll[1].toFixed(5)}, ${st.ll[0].toFixed(5)}`],
          ['สเปกกล้อง', '1920×1080 · 25 fps'],
          ['อัปเดตล่าสุด', 'เมื่อสักครู่'],
        ]}
      />
    </VPad>
  );
}

export function SensorView() {
  const id = useApp(s => s.pinSel);
  const st = useApp(s => s.sensList.find(p => p.id === id));
  if (!st) return null;
  const isDam = st.type === 'dam';
  const pct = Math.min(100, Math.round((st.lv / st.crit) * 100));
  const col = pct >= 85 ? 'var(--danger)' : pct >= 60 ? '#FFC94D' : 'var(--accent)';
  const cell = 'flex-1 rounded-[10px] border border-line bg-bg px-2.5 py-[9px]';
  const num = 'font-display text-[19px] font-bold leading-[1.1]';
  const cap = 'mt-[3px] text-[10px] text-dim2';
  const dot = (c: string) => <span className="inline-block size-[7px] shrink-0 rounded-full" style={{ background: c }} />;
  return (
    <VPad>
      <DetTop>
        <Chip bg="rgba(76,154,255,.16)" ink="#7FB4FF">{isDam ? 'เขื่อน · อัตราไหล' : 'เซ็นเซอร์น้ำท่วม'}</Chip>
        <span className="font-display text-[10.5px] text-dim2">{st.id}</span>
      </DetTop>
      <DetName>{st.name}</DetName>
      <ResCap className="!pb-1">{st.detail}</ResCap>
      <div className="mb-2 mt-3 flex gap-2.5">
        <div className={cell}><div className={num} style={{ color: col }}>{st.lv.toFixed(2)}<small className="font-display text-[11px] font-medium text-dim"> ม.</small></div><div className={cap}>ระดับน้ำปัจจุบัน</div></div>
        <div className={cell}><div className={`${num} text-danger`}>{st.crit.toFixed(2)}<small className="font-display text-[11px] font-medium text-dim"> ม.</small></div><div className={cap}>ระดับวิกฤต</div></div>
        <div className={cell}><div className={num}>{pct}%</div><div className={cap}>เทียบระดับวิกฤต</div></div>
      </div>
      <div className="mb-1 h-[7px] overflow-hidden rounded-full border border-line2 bg-bg">
        <i className="block h-full rounded-full transition-[width] duration-[400ms]" style={{ width: `${pct}%`, background: col }} />
      </div>
      <DetSub>ประวัติ 24 ชม. + พยากรณ์ 6 ชม.</DetSub>
      <div className="h-[170px] rounded-[10px] border border-line bg-bg p-2"><SensorChart pin={st} /></div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {dot('#4C9AFF')}<ResCap className="!p-0">ประวัติ</ResCap>
        {dot('var(--danger)')}<ResCap className="!p-0">วิกฤต</ResCap>
        {dot('#FFC94D')}<ResCap className="!p-0">พยากรณ์</ResCap>
      </div>
      <DetRows
        className="mt-2.5"
        rows={[
          ['ประเภทสถานี', isDam ? 'เซ็นเซอร์อัตราไหลเขื่อน' : 'เซ็นเซอร์วัดระดับน้ำ'],
          ['พิกัด', `${st.ll[1].toFixed(5)}, ${st.ll[0].toFixed(5)}`],
          ['อัปเดตล่าสุด', new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) + ' น.'],
        ]}
      />
    </VPad>
  );
}

export function PinSettingsView() {
  const op = useApp(s => s.sensOpacity);
  const on = useApp(s => s.sensOn);
  return (
    <VPad>
      <div className={`${frow} !border-none !pt-0`}>
        <span className="size-3 shrink-0 rounded" style={{ background: "#7FB4FF" }} />
        <span className={`${fl} font-semibold`}>เซ็นเซอร์น้ำ/เขื่อน<span className="font-display text-[10.5px] font-normal text-dim2"> Water Level</span></span>
        <Switch checked={on} onChange={v => patchApp({ sensOn: v })} />
      </div>
      <div className={frow}>
        <span className={fl}>ความทึบแสง</span>
        <input
          type="range" className="w-[140px]" min={0.02} max={1} step={0.02} value={op}
          onChange={e => patchApp({ sensOpacity: +e.target.value })}
          onDoubleClick={() => patchApp({ sensOpacity: 0.9 })}
        />
        <span className="w-9 text-right font-display text-[11px] font-medium">{Math.round(op * 100)}%</span>
      </div>
    </VPad>
  );
}

export function TransportView() {
  const id = useApp(s => s.pinSel);
  const st = useApp(s => s.transportList.find(p => p.id === id));
  if (!st) return null;
  const modeTh = st.mode === 'bus' ? 'รถเมล์' : st.mode === 'metro' ? 'รถไฟฟ้า' : st.mode === 'train' ? 'รถไฟ' : 'รถยนต์/จุดจอดรถ';
  return (
    <VPad>
      <DetTop><Chip bg="rgba(255,159,67,.16)" ink="#FF9F43">รถประจำทาง</Chip><span className="font-display text-[10.5px] text-dim2">{st.id}</span></DetTop>
      <DetName>{st.name}</DetName>
      <DetRows className="mt-3" rows={[['ประเภท', modeTh], ['พิกัด', `${st.ll[1].toFixed(5)}, ${st.ll[0].toFixed(5)}`], ['สถานะ', 'ข้อมูลตัวอย่าง']]} />
    </VPad>
  );
}

export function TransportSettingsView() {
  const op = useApp(s => s.transportOpacity);
  const on = useApp(s => s.transportOn);
  return (
    <VPad>
      <DetTop><Chip bg="rgba(255,159,67,.16)" ink="#FF9F43">ตั้งค่าหมุด</Chip></DetTop>
      <DetName>รถประจำทาง</DetName>
      <div className="mb-0.5 mt-3.5 text-[10.5px] font-semibold uppercase tracking-[.1em] text-dim">ความทึบแสง (opacity)</div>
      <div className={`${frow} !border-b-0`}>
        <input type="range" className="flex-1" min={0.2} max={1} step={0.05} value={op} onChange={e => patchApp({ transportOpacity: +e.target.value })} onDoubleClick={() => patchApp({ transportOpacity: 0.9 })} />
        <span className="shrink-0 rounded-md border border-line2 bg-[#0C0E0C] px-[7px] py-0.5 font-display text-[10px] font-bold text-white">{Math.round(op * 100)}%</span>
      </div>
      <div className={`${frow} !border-b-0`}><span className="flex-1 text-xs">แสดงหมุดรถประจำทาง</span><input type="checkbox" checked={on} onChange={e => patchApp({ transportOn: e.target.checked })} /></div>
      <Hint>ตั้งค่านี้มีผลกับหมุดรถเมล์ รถไฟฟ้า รถไฟ และรถยนต์/จุดจอดรถเท่านั้น</Hint>
    </VPad>
  );
}

/* ---------- search view ---------- */
type Item = SearchHit;

export function SearchView() {
  const prefill = useApp(s => s.searchPrefill);
  const [agency, setAgency] = useState('');
  const [province, setProvince] = useState('');
  const [district, setDistrict] = useState('');
  const [subdistrict, setSubdistrict] = useState('');
  const [propertyType, setPropertyType] = useState('');
  const [sellerName, setSellerName] = useState('');
  const [auctionDate, setAuctionDate] = useState<number | null>(null);
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [sizeMin, setSizeMin] = useState<SizeValue>({ mode: 'sets', rai: '', ngan: '', sq: '', single: '' });
  const [sizeMax, setSizeMax] = useState<SizeValue>({ mode: 'sets', rai: '', ngan: '', sq: '', single: '' });
  const [items, setItems] = useState<Item[]>([]);
  const [searched, setSearched] = useState(false);
  const [status, setStatus] = useState('พร้อมค้นหา');
  const [progress, setProgress] = useState<number | null>(null);
  const runId = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  const agentItems: SelectItem[] = useMemo(() => [{ v: '', l: 'ทั้งหมด' }, ...SELLER_AGENCIES.map(v => ({ v, l: v }))], []);
  const provinceItems: SelectItem[] = useMemo(() => getProvinceItems(), []);
  const districtItems: SelectItem[] = useMemo(() => getDistrictItems(province), [province]);
  const subdistrictItems: SelectItem[] = useMemo(() => getSubdistrictItems(province, district), [province, district]);
  const districtNotIn = (prov: string, d: string) => !getDistrictItems(prov).some(i => i.v === d);
  const subdistrictIn = (prov: string, d: string, s: string) => getSubdistrictItems(prov, d).some(i => i.v === s);
  const typeItems: SelectItem[] = useMemo(() => [{ v: '', l: 'ทั้งหมด' }, ...PROPERTY_TYPES.map(v => ({ v, l: v }))], []);

  const toggleSize = (which: 'min' | 'max') => {
    const cur = which === 'min' ? sizeMin : sizeMax;
    const setter = which === 'min' ? setSizeMin : setSizeMax;
    setter(toggleSizeMode(cur));
  };

  const getMinWah = (): number | null => sizeMin.mode === 'single' ? parseShortNumber(sizeMin.single) : sizeSetsToWah(sizeMin);
  const getMaxWah = (): number | null => sizeMax.mode === 'single' ? parseShortNumber(sizeMax.single) : sizeSetsToWah(sizeMax);

  const runSearch = () => {
    const id = ++runId.current;
    const min = parseShortNumber(minPrice);
    const max = parseShortNumber(maxPrice);
    const minW = getMinWah();
    const maxW = getMaxWah();
    const date = auctionDate != null ? new Date(auctionDate).setHours(0, 0, 0, 0) : null;
    const local = ALL_PARCELS.filter(p => {
      if (agency && !(p.name + ' ' + p.deed + ' ' + p.province + ' ' + p.amp + ' ' + p.tambon).toLowerCase().includes(agency.toLowerCase())) return false;
      if (province && p.province !== province) return false;
      if (district && p.amp !== district) return false;
      if (subdistrict && p.tambon !== subdistrict) return false;
      if (propertyType && propertyType !== 'ทุกประเภท' && !p.name.toLowerCase().includes(propertyType.toLowerCase())) return false;
      if (min != null && p.price < min) return false;
      if (max != null && p.price > max) return false;
      if (minW != null && p.wah < minW) return false;
      if (maxW != null && p.wah > maxW) return false;
      if (sellerName.trim() && !(p.name + ' ' + p.deed + ' ' + p.province).toLowerCase().includes(sellerName.trim().toLowerCase())) return false;
      if (date != null && new Date(p.announce).setHours(0, 0, 0, 0) !== date) return false;
      return true;
    }).map<Item>(p => ({ kind: 'land', id: String(p.id), ll: [p.lng, p.lat] as [number, number], name: p.name, sub: `${p.province} · ${p.amp} · ${p.tambon}` })).slice(0, 20);

    setItems(local);
    setSearched(true);
    setProgress(local.length ? 100 : 35);
    setStatus(local.length ? `พบ ${local.length} รายการในพื้นที่` : 'ไม่พบในพื้นที่ — กำลังค้นหาออนไลน์');
    const t = [sellerName, propertyType, district, province, agency].filter(Boolean).join(' ').trim();
    const map = getMap();
    if (t.length < 2 || !map) { input.current?.focus(); return; }
    const b = map.getBounds();
    const box: BBox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    const st = useApp.getState();
    onlineSearch(t.toLowerCase(), box, st.cascade, st.gkey, new AbortController().signal)
      .then(list => {
        if (id !== runId.current || !list.length) {
          if (id === runId.current) { setProgress(100); setStatus(local.length ? `พบ ${local.length} รายการในพื้นที่` : 'ไม่พบผลในกรอบพื้นที่'); }
          return;
        }
        setItems(cur => [...cur, ...list.map<Item>(p => ({ kind: 'place', id: p.name, ll: [p.lng, p.lat], name: p.name, sub: p.src }))]);
        if (id === runId.current) setStatus(`พบ ${local.length} ผลในระบบ + ${list.length} ผลภายนอก`);
        if (id === runId.current) setProgress(100);
      })
      .catch(() => { if (id === runId.current) setProgress(100); });
    input.current?.focus();
  };

  useEffect(() => {
    if (prefill) { setSellerName(prefill); patchApp({ searchPrefill: '' }); runSearch(); }
    const t = setTimeout(() => input.current?.focus(), 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dotColor = (k: Item['kind']) => (k === 'land' ? 'var(--accent)' : k === 'cctv' ? '#FFC94D' : k === 'transport' ? '#FF9F43' : '#4C9AFF');
  const labelCls = 'mb-1 block pl-0.5 text-[10.5px] font-semibold uppercase tracking-[.1em] text-dim2';
  const sizeInput = 'w-full min-w-0 rounded-lg border border-line2 bg-bg px-2 py-1.5 text-[11.5px] text-ink outline-none focus:border-accent';
  return (
    <VPad>
      <div className="space-y-3 px-1 py-3">
        <div><label className={labelCls}>หน่วยงานที่ขาย</label><Select value={agency} onChange={setAgency} items={agentItems} className='w-full' /></div>
        <div><label className={labelCls}>ประเภททรัพย์</label><Select value={propertyType} onChange={setPropertyType} items={typeItems} className='w-full' /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className={labelCls}>ชื่อโจกย์</label><input ref={input} className={`${inp} w-full`} value={sellerName} onChange={e => setSellerName(e.target.value)} placeholder="ชื่อโจทก์ / กส. / หน่วยงาน" autoComplete="off" /></div>
          <div><label className={labelCls}>วันที่ประมูล</label>
            <DateButton value={auctionDate} onPick={setAuctionDate} className={`${btnAcc} w-full justify-center border border-line2 !bg-bg !text-ink`}>
              {auctionDate ? numDate(auctionDate) : 'เลือกวันประมูล'}
            </DateButton>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className={labelCls}>จังหวัด</label>
            <Select clearable value={province} items={provinceItems} onChange={v => {
              setProvince(v);
              /* a district from another province is no longer valid */
              if (district && v && districtNotIn(v, district)) { setDistrict(''); setSubdistrict(''); }
            }} />
          </div>
          <div>
            <label className={labelCls}>เขต/อำเภอ</label>
            <Select clearable value={district} items={districtItems} onChange={v => {
              setDistrict(v);
              if (subdistrict && v && !subdistrictIn(province, v, subdistrict)) setSubdistrict('');
              /* auto-fill the province when the district pins it down */
              if (v && !province) {
                const ps = parentsOfDistrict(v);
                if (ps.length === 1) setProvince(ps[0]);
              }
            }} />
          </div>
          <div>
            <label className={labelCls}>แขวง/ตำบล</label>
            <Select clearable value={subdistrict} items={subdistrictItems} onChange={v => {
              setSubdistrict(v);
              if (!v) return;
              /* auto-fill both parents when they are not set already */
              const hit = parentsOfSubdistrict(v, district);
              if (!district && hit.districts.length === 1) setDistrict(hit.districts[0]);
              if (!province && hit.provinces.length === 1) setProvince(hit.provinces[0]);
            }} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className={labelCls}>ราคาต่ำสุด</label><input className={`${inp} w-full`} value={minPrice} onChange={e => setMinPrice(convertShortInput(e.target.value))} placeholder="ราคาต่ำสุด" inputMode="text" /></div>
          <div><label className={labelCls}>ราคาสูงสุด</label><input className={`${inp} w-full`} value={maxPrice} onChange={e => setMaxPrice(convertShortInput(e.target.value))} placeholder="ราคาสูงสุด" inputMode="text" /></div>
        </div>

        <div className="rounded-lg border border-line bg-bg p-2.5">
          <div className="mb-2 flex items-center justify-between">
            <label className={labelCls}>ขนาดเนื้อที่ (ต่ำสุด)</label>
            <button type="button" className="rounded-md border border-line2 bg-panel px-2 py-1 text-[10px] font-semibold text-dim hover:text-ink" onClick={() => toggleSize('min')}>{sizeMin.mode === 'sets' ? 'เฉพาะ ตร.วา' : '3 ช่อง'}</button>
          </div>
          {sizeMin.mode === 'sets' ? (
            <div className="grid grid-cols-3 gap-1.5">
              <label className="text-center"><input value={sizeMin.rai} onChange={e => setSizeMin(s => ({ ...s, rai: e.target.value }))} className={sizeInput} placeholder="ไร่" inputMode="numeric" /><div className="mt-1 text-[9.5px] text-dim2">ไร่</div></label>
              <label className="text-center"><input value={sizeMin.ngan} onChange={e => setSizeMin(s => ({ ...s, ngan: e.target.value }))} className={sizeInput} placeholder="งาน" inputMode="numeric" /><div className="mt-1 text-[9.5px] text-dim2">งาน</div></label>
              <label className="text-center"><input value={sizeMin.sq} onChange={e => setSizeMin(s => ({ ...s, sq: e.target.value }))} className={sizeInput} placeholder="ตร.วา" inputMode="numeric" /><div className="mt-1 text-[9.5px] text-dim2">ตร.วา/ตร.ม.</div></label>
            </div>
          ) : (
            <div><input value={sizeMin.single} onChange={e => setSizeMin(s => ({ ...s, single: convertShortInput(e.target.value) }))} className={`${sizeInput} w-full`} placeholder="ตร.วา/ตร.ม. (เช่น 400 หรือ 5k)" inputMode="text" /></div>
          )}
        </div>

        <div className="rounded-lg border border-line bg-bg p-2.5">
          <div className="mb-2 flex items-center justify-between">
            <label className={labelCls}>ขนาดเนื้อที่ (สูงสุด)</label>
            <button type="button" className="rounded-md border border-line2 bg-panel px-2 py-1 text-[10px] font-semibold text-dim hover:text-ink" onClick={() => toggleSize('max')}>{sizeMax.mode === 'sets' ? 'เฉพาะ ตร.วา' : '3 ช่อง'}</button>
          </div>
          {sizeMax.mode === 'sets' ? (
            <div className="grid grid-cols-3 gap-1.5">
              <label className="text-center"><input value={sizeMax.rai} onChange={e => setSizeMax(s => ({ ...s, rai: e.target.value }))} className={sizeInput} placeholder="ไร่" inputMode="numeric" /><div className="mt-1 text-[9.5px] text-dim2">ไร่</div></label>
              <label className="text-center"><input value={sizeMax.ngan} onChange={e => setSizeMax(s => ({ ...s, ngan: e.target.value }))} className={sizeInput} placeholder="งาน" inputMode="numeric" /><div className="mt-1 text-[9.5px] text-dim2">งาน</div></label>
              <label className="text-center"><input value={sizeMax.sq} onChange={e => setSizeMax(s => ({ ...s, sq: e.target.value }))} className={sizeInput} placeholder="ตร.วา" inputMode="numeric" /><div className="mt-1 text-[9.5px] text-dim2">ตร.วา/ตร.ม.</div></label>
            </div>
          ) : (
            <div><input value={sizeMax.single} onChange={e => setSizeMax(s => ({ ...s, single: convertShortInput(e.target.value) }))} className={`${sizeInput} w-full`} placeholder="ตร.วา/ตร.ม. (เช่น 800 หรือ 2k)" inputMode="text" /></div>
          )}
        </div>

        <div className="flex items-center gap-3 rounded-lg border border-line bg-bg p-3">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold text-ink">สถานะ: {status}</div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line2">
              <div className="h-full rounded-full bg-accent transition-[width] duration-500 ease-panel" style={{ width: `${progress ?? 12}%` }} />
            </div>
          </div>
          <button className={btnAcc} onClick={runSearch}><Search size={14} />ค้นหา</button>
        </div>
      </div>

      {items.map((it, i) => (
        <div key={it.kind + it.id + i} className="flex cursor-pointer items-center gap-[9px] rounded-lg p-2 hover:bg-panel2" onClick={() => gotoItem(it)}>
          <span className="inline-block size-2 flex-none rounded-full" style={{ background: dotColor(it.kind) }} />
          <div className="min-w-0">
            <div className="overflow-hidden text-ellipsis whitespace-nowrap text-xs" data-tip={esc(it.name)}>{it.name}</div>
            <div className="font-display text-[10.5px] text-dim2">{it.sub}</div>
          </div>
        </div>
      ))}
      {searched && !items.length && <ResCap>ไม่พบผลในกรอบแผนที่ปัจจุบัน — เลื่อน/ซูมแผนที่แล้วลองอีกครั้ง</ResCap>}
    </VPad>
  );
}
