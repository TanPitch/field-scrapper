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
import { Crosshair, Flag, Plus, Save, Trash2, X } from 'lucide-react';
import { api } from '../../lib/api';
import { toast, useApp } from '../../store/useApp';
import { btn, detSub, inp } from '../ui/styles';
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
        {...useTipProps('แจ้งว่าข้อมูลจาก LED ผิด — แอดมินจะตรวจสอบ')}
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded border border-line2 bg-panel2 px-[8px] py-0.5 text-[10px] font-medium text-dim hover:border-line3 hover:text-ink"
      >
        <Flag size={12} /> รายงาน
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
  note: string | null; edited_at: string; editor: string | null; editor_name: string | null;
}

interface ImageRow {
  id: number; lotId: number; kind: string; localPath: string | null; url: string | null; served: string;
}

const FIELD_LABEL: Record<string, string> = {
  tumbol: 'ตำบล', district_name: 'อำเภอ', province_name: 'จังหวัด',
  deed_number: 'เลขที่โฉนด', size: 'land size', start_price: 'ราคาเริ่มประมูล',
  latlng: 'พิกัด', round_price: 'ราคานัดขาย',
  image_added: 'เพิ่มรูป', image_removed: 'ลบรูป',
};

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
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [edits, setEdits] = useState<EditRow[] | null>(null);
  const [imgs, setImgs] = useState<ImageRow[] | null>(null);
  const [imgUrl, setImgUrl] = useState('');
  const [placing, setPlacing] = useState(false);
  const disarm = useRef<(() => void) | null>(null);

  /* Field state seeds from the parcel once per parcel — a background refetch
     of the same values must not wipe whatever is half-typed. */
  useEffect(() => {
    setAddr({ tumbol: p.tambon ?? '', district_name: p.amp ?? '', province_name: p.province ?? '' });
    setDeed(p.deedNo ?? '');
    setSize(p.sizeUnit === 'sqm' ? '' : `${p.sizeRai ?? 0}-${p.sizeNgan ?? 0}-${p.sizeWa ?? 0}`);
    setPrice(p.price != null ? String(p.price) : '');
    setLat(p.lat ? p.lat.toFixed(8) : '');
    setLng(p.lng ? p.lng.toFixed(8) : '');
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

  /* One-shot map placement: fly there, arm a single click — the next click on
     the map is the new position, and the ref keeps the unmount cleanup able
     to disarm it if the user wanders off first. */
  const placeOnMap = () => {
    const map = getMap();
    if (!map) { toast('ไม่มีแผนที่ให้คลิก', 'warn'); return; }
    map.flyTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), 15.5), duration: 850 });
    const canvas = map.getCanvas();
    canvas.style.cursor = 'crosshair';
    setPlacing(true);
    const onClick = (e: { lngLat: { lat: number; lng: number } }) => {
      canvas.style.cursor = '';
      setPlacing(false);
      disarm.current = null;
      setLat(e.lngLat.lat.toFixed(8));
      setLng(e.lngLat.lng.toFixed(8));
      toast('ได้พิกัดจากการคลิก — ตรวจแล้วกด พิกัด เพื่อบันทึก');
    };
    map.once('click', onClick);
    disarm.current = () => {
      map.off('click', onClick);
      canvas.style.cursor = '';
      setPlacing(false);
    };
  };

  const saveRoundPrice = (roundId: number, value: number | null): Promise<boolean> =>
    saveField({ field: 'round_price', roundId, value }, 'บันทึกราคานัดแล้ว');

  return (
    <div className="mt-3 rounded-[10px] border border-line2 bg-panel2/40 p-2.5" data-selectable>
      <div className={`${detSub} !mt-0`}>แก้ไขข้อมูล (แอดมิน)</div>

      <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
        <input className={`${inp} w-[110px]`} value={addr.tumbol} onChange={e => setAddr({ ...addr, tumbol: e.target.value })} placeholder="ตำบล" />
        <input className={`${inp} w-[110px]`} value={addr.district_name} onChange={e => setAddr({ ...addr, district_name: e.target.value })} placeholder="อำเภอ" />
        <input className={`${inp} w-[120px]`} value={addr.province_name} onChange={e => setAddr({ ...addr, province_name: e.target.value })} placeholder="จังหวัด" />
        <button className={btn} onClick={async () => {
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
        <input className={`${inp} w-[140px]`} value={deed} onChange={e => setDeed(e.target.value)} placeholder="เลขที่โฉนด" />
        <button className={btn} onClick={async () => {
          if (!deed.trim()) return;
          if (deed.trim() === (p.deedNo ?? '')) { toast('ไม่มีการเปลี่ยนแปลง'); return; }
          await saveField({ field: 'deed_number', value: deed.trim() }, 'บันทึกเลขโฉนดแล้ว');
        }}><Save size={13} /> โฉนด</button>

        <input className={`${inp} w-[110px]`} value={size} onChange={e => setSize(e.target.value)} placeholder="0-1-61" {...useTipProps('ไร่-งาน-วา')} />
        <button className={btn} onClick={async () => {
          const t = parseTrio(size);
          if (!t) { toast('รูปแบบ: ไร่-งาน-วา เช่น 0-1-61', 'warn'); return; }
          await saveField({ field: 'size', lotId: p.lotId, rai: t[0], ngan: t[1], wa: t[2] }, 'บันทึกขนาดแล้ว');
        }}><Save size={13} /> ขนาด</button>

        <input className={`${inp} w-[110px]`} value={price} onChange={e => setPrice(e.target.value)} placeholder="ราคา" inputMode="numeric" />
        <button className={btn} onClick={async () => {
          const v = Number(price.replace(/[^\d.]/g, ''));
          if (!Number.isFinite(v) || v < 0) { toast('ราคาไม่ถูกต้อง', 'warn'); return; }
          await saveField({ field: 'start_price', lotId: p.lotId, value: v }, 'บันทึกราคาแล้ว');
        }}><Save size={13} /> ราคา</button>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11.5px]">
        <input className={`${inp} w-[150px]`} value={lat} onChange={e => setLat(e.target.value)} placeholder="lat" inputMode="decimal" />
        <input className={`${inp} w-[150px]`} value={lng} onChange={e => setLng(e.target.value)} placeholder="lng" inputMode="decimal" />
        <button className={`${btn} ${placing ? 'border-accent text-accent' : ''}`} onClick={placeOnMap}>
          <Crosshair size={13} /> {placing ? 'คลิกบนแผนที่…' : 'วางบนแผนที่'}
        </button>
        <button className={btn} onClick={async () => {
          const la = Number(lat), lo = Number(lng);
          if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) { toast('พิกัดไม่ถูกต้อง', 'warn'); return; }
          await saveField({ field: 'latlng', lat: la, lng: lo }, 'ย้ายจุดแล้ว');
        }}><Save size={13} /> พิกัด</button>
      </div>

      {/* นัด prices: LED printed each row; a wrong figure is fixed per row and
          the history names the date it belonged to. */}
      {p.rounds.some(r => r.roundId != null) && (
        <div className="mt-1.5 text-[11px]">
          {p.rounds.filter(r => r.roundId != null).map((r, i) => (
            <RoundPriceRow key={r.roundId} i={i} r={r} onSave={saveRoundPrice} />
          ))}
        </div>
      )}

      {/* Images: every lot row of the parcel — a downloaded file shows its
          served path, an admin-added one its stored URL. */}
      <div className="mt-2">
        <div className="text-[10.5px] font-semibold uppercase tracking-[.1em] text-dim">รูปประกอบ</div>
        {(imgs ?? []).map(im => (
          <div key={im.id} className="mt-1 flex items-center gap-1.5 text-[10.5px] text-dim2">
            <span className="truncate">{im.served}</span>
            <button
              {...useTipProps('ลบรูปนี้ (บันทึกในประวัติ)')}
              className="ml-auto grid size-[22px] place-items-center rounded border border-line2 text-dim2 hover:border-[#E5484D] hover:text-[#FF8B7D]"
              onClick={async () => {
                const r = await api.del(`/api/admin/lot-images/${im.id}?parcelId=${p.id}`);
                if (r.ok) { toast('ลบรูปแล้ว'); refreshParcels(); await loadImages(); }
                else toast(r.error ?? 'ลบไม่สำเร็จ', 'warn');
              }}
            ><Trash2 size={12} /></button>
          </div>
        ))}
        {imgs != null && imgs.length === 0 && <div className="mt-1 text-[10.5px] text-dim2">ไม่มีรูป</div>}
        <div className="mt-1.5 flex items-center gap-1.5">
          <input className={`${inp} min-w-0 flex-1`} value={imgUrl} onChange={e => setImgUrl(e.target.value)} placeholder="https://… (URL รูปเพิ่ม)" />
          <button className={btn} onClick={async () => {
            if (!/^https?:\/\//i.test(imgUrl.trim())) { toast('URL ไม่ถูกต้อง', 'warn'); return; }
            const r = await api.post('/api/admin/lot-images', { lotId: p.lotId, parcelId: p.id, url: imgUrl.trim(), kind: 'photo' });
            if (r.ok) { toast('เพิ่มรูปแล้ว'); setImgUrl(''); refreshParcels(); await loadImages(); }
            else toast(r.error ?? 'เพิ่มไม่สำเร็จ', 'warn');
          }}><Plus size={13} /> เพิ่ม</button>
        </div>
      </div>

      {/* History — the single accountable record of every admin write. */}
      <div className="mt-2.5">
        <div className="text-[10.5px] font-semibold uppercase tracking-[.1em] text-dim">ประวัติการแก้ไข</div>
        {edits === null && <div className="mt-1 text-[10.5px] text-dim2">กำลังโหลด…</div>}
        {edits != null && edits.length === 0 && <div className="mt-1 text-[10.5px] text-dim2">ยังไม่มีการแก้ไข</div>}
        {edits != null && edits.map(e => (
          <div key={e.id} className="mt-1 leading-[1.6] text-[10.5px] text-dim2">
            {FIELD_LABEL[e.field_name] ?? e.field_name}{e.note ? ` [${e.note}]` : ''}
            {' : '}<span className="text-dim">{e.old_value ?? '—'}</span>
            {' → '}<span className="text-ink">{e.new_value ?? '—'}</span>
            {' ('}{thDT(e.edited_at)}{')'}
            {e.editor ? ` · ${e.editor}` : ''}
          </div>
        ))}
      </div>
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
    <div className="mt-1 flex items-center gap-1.5">
      <span className="w-[64px] flex-none text-dim2">
        {r.date != null ? new Date(r.date).toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: '2-digit' }) : 'ไม่มีวันที่'}
      </span>
      <input className={`${inp} w-[100px]`} value={v} onChange={e => setV(e.target.value)} inputMode="numeric" placeholder="—" />
      <button className={btn} onClick={async () => {
        const t = v.trim();
        const num = t === '' ? null : Number(t.replace(/[^\d.]/g, ''));
        if (t !== '' && (!Number.isFinite(num) || (num as number) < 0)) { toast('ราคาไม่ถูกต้อง', 'warn'); return; }
        await onSave(r.roundId as number, num as number | null);
      }}><Save size={12} /></button>
      {i === 0 && <span className="text-dim2">ราคาตามตารางนัด (เว้นว่าง = ล้างค่า)</span>}
    </div>
  );
}
