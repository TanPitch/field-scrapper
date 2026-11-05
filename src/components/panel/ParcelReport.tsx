/* ParcelReport.tsx — "the LED figure is wrong" flow.
 *
 * ReportButton: any signed-in user flags the parcel — topic + free detail —
 * into parcel_reports, which the admin's รายงานข้อมูล pane lists.
 *
 * AdminEditor: the admin fixes what LED got wrong. Every save = one field =
 * one parcel_edits row (old → new, editor, time), so the history below renders
 * exactly what was touched and when ("land size : 0-1-16 -> 0-1-61").
 * lat/lng walks the hand-quad (td pair + geom + verdict + precision) the
 * coord-gaps path already established, and can be placed by clicking the map.
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Crosshair, Flag, Plus, Save, Trash2, Undo2, Upload, X } from 'lucide-react';
import { api } from '../../lib/api';
import { parseCoordPair } from '../../lib/coord';
import { toast, useApp, patchApp } from '../../store/useApp';
import { btn, inp } from '../ui/styles';
import { useTipProps } from '../ui/Tip';
import { getMap } from '../../map/mapRef';
import { useRefreshParcels } from '../../hooks/useParcels';
import { refreshParcel } from '../../data/liveData';
import type { Parcel, SellRound } from '../../types';

/*------------------------------ report modal ------------------------------*/

const TOPICS = ['พิกัดผิด', 'ขนาดผิด', 'ราคาผิด', 'ข้อมูลโฉนดผิด', 'ตำบล/อำเภอผิด', 'อื่น ๆ'];

export function ReportButton({ p }: { p: Parcel }) {
  const [open, setOpen] = useState(false);
  const signedIn = useApp(s => s.signedIn);
  if (!signedIn) return null;
  return (
    <>
      <button
        type="button"
        {...useTipProps('แจ้งข้อมูลผิด')}
        onClick={() => setOpen(true)}
        className="grid size-[26px] place-items-center rounded-[5px] text-dim hover:bg-panel2 hover:text-ink"
      >
        <Flag size={12} />
      </button>
      {open && <ReportModal p={p} onClose={() => setOpen(false)} />}
    </>
  );
}

function ReportModal({ p, onClose }: { p: Parcel; onClose: () => void }) {
  const [topic, setTopic] = useState('');
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const send = async () => {
    if (!topic.trim() || !detail.trim()) { toast('กรอกหัวข้อและรายละเอียด', 'warn'); return; }
    setBusy(true);
    const r = await api.post(`/api/parcels/${p.id}/report`, { topic, detail });
    setBusy(false);
    if (r.ok) { toast('ส่งรายงานแล้ว ขอบคุณ'); onClose(); }
    else toast(r.error ?? 'ส่งไม่สำเร็จ', 'warn');
  };

  return (
    <div className="fixed inset-0 z-[150]">
      <div className="absolute inset-0 bg-black/45" onClick={onClose} />
      <div className="absolute left-1/2 top-1/2 w-[min(94vw,460px)] -translate-x-1/2 -translate-y-1/2">
        <div data-selectable className="rounded-xl border border-line2 bg-panel p-3 shadow-2xl">
          <div className="flex items-center text-[12.5px] font-semibold">
            <Flag size={14} className="mr-1.5 text-accent" /> รายงานข้อมูลผิด — {p.deedNo || p.caseNo}
            <button className="ml-auto grid size-6 place-items-center rounded text-dim2 hover:text-ink" onClick={onClose}><X size={14} /></button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {TOPICS.map(t => (
              <button key={t} onClick={() => setTopic(t === topic ? '' : t)}
                className={`rounded-md border px-2 py-[3px] text-[11px] ${topic === t ? 'border-accent bg-accent-dim text-accent' : 'border-line2 text-dim hover:text-ink'}`}>
                {t}
              </button>
            ))}
          </div>
          <textarea
            value={detail}
            onChange={e => setDetail(e.target.value)}
            rows={4}
            placeholder="บอกว่าอะไรผิด เช่น พิกัดจากเว็บ LED ต้องเป็น 16.41368126,102.83346891 / ขนาดจริง 0-1-61…"
            className={`${inp} mt-2 h-auto resize-y py-2 leading-[1.6]`}
          />
          <div className="mt-2 flex justify-end gap-1.5">
            <button className={btn} onClick={onClose}>ยกเลิก</button>
            <button className={`${btn} border-accent text-accent`} disabled={busy} onClick={send}>
              <Save size={13} /> {busy ? 'กำลังส่ง…' : 'ส่งรายงาน'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/*------------------------------ admin editor ------------------------------*/

interface EditRow {
  id: number; field_name: string; old_value: string | null; new_value: string | null;
  note: string | null; ref_id: number | null; lot_id: number | null; edited_at: string;
  editor: string | null; editor_name: string | null;
}

interface ImageRow {
  id: number; lotId: number; kind: string; localPath: string | null; url: string | null;
  served: string; sortNo: number | null;
}

interface Trio { tumbol: string; district_name: string; province_name: string }

const FIELD_LABEL: Record<string, string> = {
  tumbol: 'ตำบล', district_name: 'อำเภอ', province_name: 'จังหวัด',
  deed_number: 'เลขที่โฉนด', size: 'land size', start_price: 'ราคาเริ่มประมูล',
  latlng: 'พิกัด', round_price: 'ราคานัดขาย',
  image_added: 'เพิ่มรูป', image_removed: 'ลบรูป', image_order: 'เรียงรูป',
};

/* Start prices are money: the input shows what LED printed (with commas), the
   save strips the display separators before sending a plain number. Typing
   formats live — digits only, commas re-inserted between every group. */
const money = (v: number): string => v.toLocaleString('en-US');
const commas = (typed: string): string =>
  typed.replace(/[^\d]/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const thDT = (s: string): string => {
  const d = new Date(s);
  return d.toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: '2-digit' })
    + ' ' + d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
};

/* 0-1-61 → {rai, ngan, wa}. Separators are LED's own dash and the slash/comma
 * a hand recorder sometimes types; empty parts stay null (e.g. "-1-61"). */
function parseTrio(s: string): [number | null, number | null, number | null] | null {
  const parts = s.trim().split(/\s*[-/,]\s*/);
  if (parts.length !== 3) return null;
  const nums = parts.map(x => x === '' ? null : Number(x.replace(',', '.')));
  if (nums.some(n => n != null && (!Number.isFinite(n) || n < 0 || n >= 10000))) return null;
  if (nums.every(n => n == null)) return null;
  return nums as [number | null, number | null, number | null];
}

export function AdminEditor({ p }: { p: Parcel }) {
  const isAdmin = useApp(s => s.role === 'admin');
  const signedIn = useApp(s => s.signedIn);
  const refreshParcels = useRefreshParcels();
  const [addr, setAddr] = useState({ tumbol: '', district_name: '', province_name: '' });
  const [deed, setDeed] = useState('');
  const [size, setSize] = useState('');
  const [price, setPrice] = useState('');
  /* One coordinate text box, like ข้อมูลตกหล่น's own: "16.41, 102.83" or two
     space-split decimals — the paste-safe reading is one helper for the app. */
  const [coord, setCoord] = useState('');
  const [edits, setEdits] = useState<EditRow[] | null>(null);
  const [imgs, setImgs] = useState<ImageRow[] | null>(null);
  const [imgUrl, setImgUrl] = useState('');
  const [trios, setTrios] = useState<Trio[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [placing, setPlacing] = useState(false);
  /* Full-size view of an editor thumbnail — one overlay, click anywhere closes. */
  const [viewImg, setViewImg] = useState<string | null>(null);
  const disarm = useRef<(() => void) | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /* Field state seeds from the parcel once per parcel — a background refetch
     of the same values must not wipe whatever is half-typed. The price seed is
     the lot's start price (LED's pre-discount figure), not the headline the
     panel shows — that one can already carry a discount rung. */
  useEffect(() => {
    setAddr({ tumbol: p.tambon ?? '', district_name: p.amp ?? '', province_name: p.province ?? '' });
    setDeed(p.deedNo ?? '');
    setSize(p.sizeUnit === 'sqm' ? '' : `${p.sizeRai ?? 0}-${p.sizeNgan ?? 0}-${p.sizeWa ?? 0}`);
    setPrice(p.startPrice != null ? money(p.startPrice) : '');
    setCoord(p.lat != null && p.lng != null ? `${p.lat.toFixed(8)}, ${p.lng.toFixed(8)}` : '');
    setEdits(null); setImgs(null);
  }, [p.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!signedIn || !isAdmin) return null;

  const loadHistory = async () => {
    const r = await api.get<{ edits: EditRow[] }>(`/api/admin/parcel-edits?parcelId=${p.id}`);
    if (r.ok) setEdits(r.data?.edits ?? []);
  };
  const loadImages = async () => {
    const r = await api.get<{ images: ImageRow[] }>(`/api/admin/lot-images?parcelId=${p.id}`);
    if (r.ok) setImgs(r.data?.images ?? []);
  };
  /* The searchable dropdown's options: every ตำบล the DB has ever carried,
     grouped by its อำเภอ/จังหวัด. Writing a new value to a parcel adds it to
     the dict by being in the table — nothing else to sync. */
  useEffect(() => {
    void api.get<{ trios: Trio[] }>('/api/admin/place-dict').then((r) => {
      if (r.ok) setTrios(r.data?.trios ?? []);
    });
  }, [p.id]);
  useEffect(() => {
    void loadHistory();
    void loadImages();
    /* Leaving the editor while the map is armed for a click must disarm it —
       a parcel-bound cleanup, not a never-fires cleanup. */
    return () => { try { disarm.current?.(); } catch { /* map already gone */ } };
  }, [p.id]);

  /* One save → the field's PATCH → history reload. Server errors (a deed the
     unique index owns) surface as-is; the 409 text is already Thai. */
  const saveField = async (body: Record<string, unknown>, okMsg: string): Promise<boolean> => {
    const r = await api.patch<{ changed?: boolean; editedAt?: string }>(`/api/admin/parcel-fields/${p.id}`, body);
    if (!r.ok) { toast(r.error ?? 'บันทึกไม่สำเร็จ', 'warn'); return false; }
    if (r.data?.changed === false) { toast('ไม่มีการเปลี่ยนแปลง'); return true; }
    void refreshParcel(p.id);
    refreshParcels();
    await loadHistory();
    toast(okMsg);
    return true;
  };

  /* One-shot map placement: fly there, arm a single click — the click's pair
     lands in the single coord box; the ref keeps the unmount cleanup able to
     disarm it if the user wanders off first. While armed, `coordPick` stands
     the map's own click handling down: without it, the same click that placed
     the pin also counted as a map click that deselected the parcel and closed
     the panel that was running the edit. */
  const placeOnMap = () => {
    const map = getMap();
    if (!map) { toast('ไม่มีแผนที่ให้คลิก', 'warn'); return; }
    map.flyTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), 15.5), duration: 850 });
    const canvas = map.getCanvas();
    canvas.style.cursor = 'crosshair';
    setPlacing(true);
    patchApp({ coordPick: true });
    const onClick = (e: { lngLat: { lat: number; lng: number } }) => {
      canvas.style.cursor = '';
      setPlacing(false);
      patchApp({ coordPick: false });
      disarm.current = null;
      setCoord(`${e.lngLat.lat.toFixed(8)}, ${e.lngLat.lng.toFixed(8)}`);
      toast('ได้พิกัดจากการคลิก — ตรวจแล้วกด พิกัด เพื่อบันทึก');
    };
    map.once('click', onClick);
    disarm.current = () => {
      map.off('click', onClick);
      canvas.style.cursor = '';
      setPlacing(false);
      patchApp({ coordPick: false });
    };
  };

  /* History carries enough to undo every scalar field: the same PATCH that
     wrote the change writes the revert, so an admin mistake is auditable both
     ways. Image rows revert only through add/delete — no hidden state. */
  const revertRequest = (e: EditRow): null | Record<string, unknown> | { restoreImage: string } => {
    const v = e.old_value;
    switch (e.field_name) {
      case 'tumbol': case 'district_name': case 'province_name': case 'deed_number':
        return v == null || v === '' ? null : { field: e.field_name, value: v };
      case 'size': {
        const t = v ? parseTrio(v) : null;
        return t ? { field: 'size', lotId: e.lot_id, rai: t[0], ngan: t[1], wa: t[2] } : null;
      }
      case 'start_price': {
        const n = v == null ? null : Number(v);
        return n != null && Number.isFinite(n) ? { field: 'start_price', lotId: e.lot_id, value: n } : null;
      }
      case 'latlng': {
        const c = v ? parseCoordPair(v) : null;
        return c ? { field: 'latlng', lat: c[0], lng: c[1] } : null;
      }
      case 'round_price': {
        if (e.ref_id == null) return null;
        const num = v === '' ? null : Number(v);
        return num == null || !Number.isFinite(num) ? null : { field: 'round_price', roundId: e.ref_id, value: num };
      }
      /* A removed image restores straight back: its link survived in the row. */
      case 'image_removed':
        return v ? { restoreImage: /^https?:\/\//i.test(v) ? v : `/img/land/${v}` } : null;
      default:
        return null;
    }
  };

  const saveImageOrder = async (ids: number[]) => {
    const r = await api.patch('/api/admin/lot-images/order', { parcelId: p.id, order: ids });
    if (r.ok) { void refreshParcel(p.id); refreshParcels(); await loadImages(); await loadHistory(); }
    else toast(r.error ?? 'เรียงรูปไม่สำเร็จ', 'warn');
  };

  const saveRoundPrice = (roundId: number, value: number | null): Promise<boolean> =>
    saveField({ field: 'round_price', roundId, value }, 'บันทึกราคานัดแล้ว');

  return (
    <div data-selectable className="mt-1">
      {/* ที่ตั้ง — a searchable dropdown per level (native datalist: typing
          filters, clicking picks, free typing adds a name). Options come from
          the DB's own trio list, narrowed by what is already set above. */}
      <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
        <datalist id="pd-amp">{(trios ?? []).filter(t => !addr.province_name.trim() || t.province_name === addr.province_name.trim()).map((t, i) => <option key={t.district_name + i} value={t.district_name} />)}</datalist>
        <datalist id="pd-tab">{(trios ?? []).filter(t =>
          (!addr.province_name.trim() || t.province_name === addr.province_name.trim())
          && (!addr.district_name.trim() || t.district_name === addr.district_name.trim())).map((t, i) => <option key={t.tumbol + i} value={t.tumbol} />)}</datalist>
        <input className={`${inp} flex-1`} list="pd-tab" value={addr.tumbol} onChange={e => setAddr({ ...addr, tumbol: e.target.value })} placeholder="ตำบล — พิมพ์เพื่อค้น/เพิ่มใหม่" />
        <input className={`${inp} flex-1`} list="pd-amp" value={addr.district_name} onChange={e => setAddr({ ...addr, district_name: e.target.value })} placeholder="อำเภอ — พิมพ์เพื่อค้น/เพิ่มใหม่" />
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11.5px]">
        <datalist id="pd-prov">{[...new Set((trios ?? []).map(t => t.province_name))].filter(Boolean).map(n => <option key={n} value={n} />)}</datalist>
        <input className={`${inp} flex-1`} list="pd-prov" value={addr.province_name} onChange={e => setAddr({ ...addr, province_name: e.target.value })} placeholder="จังหวัด — พิมพ์เพื่อค้น/เพิ่มใหม่" />
        <button className={`${btn} w-[70px]`} onClick={async () => {
          let any = false;
          for (const f of ['tumbol', 'district_name', 'province_name'] as const) {
            const cur = f === 'tumbol' ? p.tambon : f === 'district_name' ? p.amp : p.province;
            if (addr[f].trim() && addr[f].trim() !== (cur ?? '')) {
              if (!await saveField({ field: f, value: addr[f].trim() }, 'บันทึกที่ตั้งแล้ว')) return;
              any = true;
            }
          }
          if (!any) toast('ไม่มีการเปลี่ยนแปลง');
        }}><Save size={13} /> ที่ตั้ง</button>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11.5px]">
        <input className={`${inp} flex-1`} value={deed} onChange={e => setDeed(e.target.value)} placeholder="เลขที่โฉนด" />
        <button className={`${btn} w-[70px]`} onClick={async () => {
          if (!deed.trim()) return;
          if (deed.trim() === (p.deedNo ?? '')) { toast('ไม่มีการเปลี่ยนแปลง'); return; }
          await saveField({ field: 'deed_number', value: deed.trim() }, 'บันทึกเลขโฉนดแล้ว');
        }}><Save size={13} /> โฉนด</button>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11.5px]">
        <input className={`${inp} flex-1`} value={size} onChange={e => setSize(e.target.value)} placeholder="0-1-61" {...useTipProps('ไร่-งาน-วา')} />
        <button className={`${btn} w-[70px]`} onClick={async () => {
          const t = parseTrio(size);
          if (!t) { toast('รูปแบบ: ไร่-งาน-วา เช่น 0-1-61', 'warn'); return; }
          await saveField({ field: 'size', lotId: p.lotId, rai: t[0], ngan: t[1], wa: t[2] }, 'บันทึกขนาดแล้ว');
        }}><Save size={13} /> ขนาด</button>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11.5px]">
        {/* LED's pre-discount figure, comma-separated as printed. Starts the
            ladder from the lot row, never from the discounted headline. */}
        <input className={`${inp} flex-1`} value={price} onChange={e => setPrice(commas(e.target.value))}
          placeholder="ราคาเริ่มประมูล (เลขหลักพัน)" inputMode="numeric"
          {...useTipProps('ราคาเริ่มประมูลของนัดแรก — ไม่ใช่ราคาที่ลดแล้ว')} />
        <button className={`${btn} w-[70px]`} onClick={async () => {
          const v = Number(price.replace(/[,\s]/g, ''));
          if (!Number.isFinite(v) || v < 0) { toast('ราคาไม่ถูกต้อง', 'warn'); return; }
          await saveField({ field: 'start_price', lotId: p.lotId, value: v }, 'บันทึกราคาเริ่มประมูลแล้ว');
        }}><Save size={13} /> ราคา</button>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11.5px]">
        <input className={`${inp} flex-1`} value={coord} onChange={e => setCoord(e.target.value)}
          placeholder="lat, lng เช่น 16.41366435, 102.83346709" inputMode="decimal"
          {...useTipProps('พิมพ์พิกัดรวมช่องเดียว หรือกด วาง แล้วคลิกบนแผนที่')} />
        <button className={`${btn} ${placing ? 'border-accent text-accent' : ''}`} onClick={placeOnMap}>
          <Crosshair size={13} /> {placing ? 'คลิก…' : 'วาง'}
        </button>
        <button className={`${btn} w-[70px]`} onClick={async () => {
          const c = parseCoordPair(coord);
          if (!c) { toast('พิกัดไม่ถูกต้อง — ต้องฝั่ง lat, lng ในประเทศไทย', 'warn'); return; }
          setCoord(`${c[0]}, ${c[1]}`);
          await saveField({ field: 'latlng', lat: c[0], lng: c[1] }, 'ย้ายจุดแล้ว');
        }}><Save size={13} /> พิกัด</button>
      </div>

      {/* นัด prices: LED printed each row; a wrong figure is fixed per row and
          the history names the date it belonged to. */}
      {p.rounds.some(r => r.roundId != null) && (
        <div className="mt-1.5 text-[11px]">
          <span className="text-dim2">ราคาตามตารางนัด (เว้นว่าง = ล้างค่า)</span>
          {p.rounds.filter(r => r.roundId != null).map((r, i) => (
            <RoundPriceRow key={r.roundId} i={i} r={r} onSave={saveRoundPrice} />
          ))}
        </div>
      )}

      {/* Images: thumbnails in the order the carousel serves them, one group
          per lot. Delete, re-upload (sha-named file into the image root), and
          reorder — each writes its history row. */}
      <div className="mt-2">
        <div className="text-[10.5px] font-semibold uppercase tracking-[.1em] text-dim">รูปประกอบ</div>
        {imgs === null && <div className="mt-1 text-[10.5px] text-dim2">กำลังโหลด…</div>}
        {imgs != null && imgs.length === 0 && <div className="mt-1 text-[10.5px] text-dim2">ไม่มีรูป</div>}
        {[...new Set((imgs ?? []).map(im => im.lotId))].map(lotId => {
          const rowList = (imgs ?? []).filter(im => im.lotId === lotId);
          const ids = rowList.map(im => im.id);
          return (
            <div key={lotId} className="mt-1.5">
              <div className="text-[10px] text-dim2">lot {lotId} {rowList.length > 1 ? `(ลำดับกำหนดเอง)` : ''}</div>
              {rowList.map((im, i) => (
                <div key={im.id} className="mt-1 flex items-center gap-1.5 text-[10.5px] text-dim2">
                  {/* The served value doubles as the preview; onError tells the
                      truth about a dead link instead of a blank square. Click
                      opens the full image on an overlay. */}
                  <img src={im.served} alt="" className="size-9 flex-none cursor-zoom-in rounded-[6px] border border-line2 bg-panel2 object-cover hover:border-accent"
                    onClick={() => setViewImg(im.served)}
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }} />
                  <span className="min-w-0 flex-1 truncate text-dim">{im.served}</span>
                  {rowList.length > 1 && (
                    <span className="flex-none">
                      <button {...useTipProps('เลื่อนขึ้น')} disabled={i === 0 || uploading}
                        className="grid size-[22px] cursor-pointer place-items-center rounded border border-line2 text-dim2 hover:text-ink disabled:cursor-default disabled:opacity-30"
                        onClick={() => { const swap = [...ids]; [swap[i - 1], swap[i]] = [swap[i], swap[i - 1]]; void saveImageOrder(swap); }}
                      ><ChevronUp size={12} /></button>
                      <button {...useTipProps('เลื่อนลง')} disabled={i === rowList.length - 1 || uploading}
                        className="grid size-[22px] cursor-pointer place-items-center rounded border border-line2 text-dim2 hover:text-ink disabled:cursor-default disabled:opacity-30"
                        onClick={() => { const swap = [...ids]; [swap[i], swap[i + 1]] = [swap[i + 1], swap[i]]; void saveImageOrder(swap); }}
                      ><ChevronDown size={12} /></button>
                    </span>
                  )}
                  <button
                    {...useTipProps('ลบรูปนี้ (บันทึกในประวัติ)')}
                    className="grid size-[22px] flex-none place-items-center rounded border border-line2 text-dim2 hover:border-[#E5484D] hover:text-[#FF8B7D]"
                    onClick={async () => {
                      const r = await api.del(`/api/admin/lot-images/${im.id}?parcelId=${p.id}`);
                      if (r.ok) { toast('ลบรูปแล้ว'); void refreshParcel(p.id); refreshParcels(); await loadImages(); await loadHistory(); }
                      else toast(r.error ?? 'ลบไม่สำเร็จ', 'warn');
                    }}
                  ><Trash2 size={12} /></button>
                </div>
              ))}
            </div>
          );
        })}
        <div className="mt-1.5 flex items-center gap-1.5">
          <input className={`${inp} flex-1`} value={imgUrl} onChange={e => setImgUrl(e.target.value)} placeholder="https://… (เพิ่มด้วย URL)" />
          <button className={btn} onClick={async () => {
            if (!/^https?:\/\//i.test(imgUrl.trim())) { toast('URL ไม่ถูกต้อง', 'warn'); return; }
            const r = await api.post('/api/admin/lot-images', { lotId: p.lotId, parcelId: p.id, url: imgUrl.trim(), kind: 'photo' });
            if (r.ok) { toast('เพิ่มรูปแล้ว'); setImgUrl(''); void refreshParcel(p.id); refreshParcels(); await loadImages(); await loadHistory(); }
            else toast(r.error ?? 'เพิ่มไม่สำเร็จ', 'warn');
          }}><Plus size={13} /> เพิ่ม</button>
          {/* Upload goes through raw octet-stream — the file is the body, the
              ids ride the query, no multipart parser anywhere. */}
          <button className={btn} disabled={uploading}
            onClick={() => fileRef.current?.click()}>
            {uploading ? <Upload size={13} className="animate-pulse" /> : <Upload size={13} />} อัปโหลด
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f || !p.lotId) return;
            if (!f.type.startsWith('image/')) { toast('ไฟล์ต้องเป็นรูปภาพ', 'warn'); return; }
            if (f.size > 20 * 1024 * 1024) { toast('ไฟล์ใหญ่กว่า 20MB', 'warn'); return; }
            setUploading(true);
            try {
              const r = await fetch(`/api/admin/lot-images/upload?lotId=${p.lotId}&parcelId=${p.id}`,
                { method: 'POST', headers: { 'Content-Type': f.type }, body: f });
              const j = await r.json().catch(() => ({}));
              if (!r.ok) toast(j.error ?? 'อัปโหลดไม่สำเร็จ', 'warn');
              else toast('อัปโหลดแล้ว');
            } catch { toast('อัปโหลดไม่สำเร็จ', 'warn'); }
            setUploading(false);
            void refreshParcel(p.id); refreshParcels();
            await loadImages(); await loadHistory();
          }} />
        </div>
      </div>

      {/* History — the single accountable record of every admin write, and the
          undo surface: the same PATCH that made the change can take the old
          value back, and writes its own row doing so. */}
      <div className="mt-2.5">
        <div className="text-[10.5px] font-semibold uppercase tracking-[.1em] text-dim">ประวัติการแก้ไข</div>
        {edits === null && <div className="mt-1 text-[10.5px] text-dim2">กำลังโหลด…</div>}
        {edits != null && edits.length === 0 && <div className="mt-1 text-[10.5px] text-dim2">ยังไม่มีการแก้ไข</div>}
        {edits != null && edits.map(e => {
          const req = revertRequest(e);
          return (
            <div key={e.id} className="mt-1 flex items-center gap-1.5 leading-[1.6] text-[10.5px] text-dim2">
              <span className="min-w-0 flex-1">
                {FIELD_LABEL[e.field_name] ?? e.field_name}{e.note ? ` [${e.note}]` : ''}
                {' : '}<span className="text-dim">{e.old_value ?? '—'}</span>
                {' → '}<span className="text-ink">{e.new_value ?? '—'}</span>
                {' ('}{thDT(e.edited_at)}{')'}
                {e.editor ? ` · ${e.editor}` : ''}
              </span>
              {req && (
                <button
                  {...useTipProps('กลับค่าก่อนแก้ไข (เขียนประวัติใหม่ให้ด้วย)')}
                  className="grid size-[22px] flex-none place-items-center rounded border border-line2 text-dim2 hover:border-accent hover:text-accent"
                  onClick={async () => {
                    if ('restoreImage' in req) {
                      const r = await api.post('/api/admin/lot-images', { lotId: e.lot_id, parcelId: p.id, url: req.restoreImage, kind: 'photo' });
                      if (r.ok) { toast('กู้รูปกลับแล้ว'); void refreshParcel(p.id); refreshParcels(); await loadImages(); await loadHistory(); }
                      else toast(r.error ?? 'กู้รูปไม่สำเร็จ', 'warn');
                      return;
                    }
                    await saveField(req as Record<string, unknown>, 'กลับค่าก่อนหน้าแล้ว');
                  }}
                ><Undo2 size={12} /></button>
              )}
            </div>
          );
        })}
        {edits != null && edits.some(x => x.field_name === 'round_price' && x.ref_id == null) && (
          <div className="mt-1 text-[10px] text-dim2">แถวราคานัดเก่าบางรายการไม่มีข้อมูลอ้างนัด — ย้อนไม่ได้</div>
        )}
      </div>

      {viewImg && (
        <div className="fixed inset-0 z-[150] grid cursor-zoom-out place-items-center bg-black/85 backdrop-blur-sm" onClick={() => setViewImg(null)}>
          <img src={viewImg} alt="รูปขยาย" className="max-h-[90vh] max-w-[92vw] rounded-[10px]" />
        </div>
      )}
    </div>
  );
}

function RoundPriceRow({ i, r, onSave }: {
  i: number;
  r: SellRound;
  onSave: (roundId: number, value: number | null) => Promise<boolean>;
}) {
  const [v, setV] = useState(r.price != null ? String(r.price) : '');
  if (r.roundId == null) return null;
  return (
    <div className="mt-1 flex items-center gap-1.5 hover:bg-panel2">
      <span className="w-[64px] flex-none text-dim2">
        {r.date != null ? new Date(r.date).toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: '2-digit' }) : 'ไม่มีวันที่'}
      </span>
      <input className={`${inp} flex-1`} value={v} onChange={e => setV(commas(e.target.value))} inputMode="numeric" placeholder="—" />
      <button className={btn} onClick={async () => {
        const t = v.trim();
        const num = t === '' ? null : Number(t.replace(/[^\d.]/g, ''));
        if (t !== '' && (!Number.isFinite(num) || (num as number) < 0)) { toast('ราคาไม่ถูกต้อง', 'warn'); return; }
        await onSave(r.roundId as number, num as number | null);
      }}><Save size={12} /></button>
    </div>
  );
}
