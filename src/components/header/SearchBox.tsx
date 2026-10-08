import maplibregl from 'maplibre-gl';
import { Bus, Database, Globe, MapPin, Search, Video, Waves } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ACCENT } from '../../data/constants';
import { ALL_PARCELS, PARCEL_BY_ID } from '../../data/mockData';
import { useMoney } from '../../hooks/useMoney';
import { esc, debounce } from '../../lib/format';
import { parcelDot } from '../../lib/parcelColor';
import { onlineSearch, poiIcon } from '../../lib/onlineSearch';
import { getMap } from '../../map/mapRef';
import { currentBbox, gotoItem, inBbox, lucideSvgByName, matchPins, plotSearch, ringAt, setSearchPickHandler } from '../../map/pins';
import { select } from '../../store/actions';
import { getApp, toast, useApp } from '../../store/useApp';
import { centerInside, useSearch, type OnlinePlace } from '../../store/useSearch';
import type { BBox, LngLat, SearchHit } from '../../types';

interface Row {
  rid: string;
  kind: 'land' | 'cctv' | 'sensor' | 'place' | 'transport';
  ll: LngLat;
  name: string;
  sub: string;
  dot?: string;
  place?: OnlinePlace;
  hit?: SearchHit;
  parcelId?: number;
}

/* single result marker on the map (kept outside React: it is a maplibre object) */
let searchMarker: maplibregl.Marker | null = null;
function showSearchPin(ll: LngLat, icon: string, label: string, color: string): void {
  const map = getMap(); if (!map) return;
  searchMarker?.remove();
  const el = document.createElement('div');
  el.className = 'sp-pin';
  el.style.setProperty('--spc', color);
  el.title = label;
  el.innerHTML = lucideSvgByName(icon);
  searchMarker = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(ll).addTo(map);
}

const rowCls = (kb: boolean) => `flex cursor-pointer items-center gap-[9px] px-[13px] py-2 text-[12.5px] hover:bg-panel2 ${kb ? 'bg-panel2' : ''}`;
const groupCls = 'flex items-center gap-[7px] px-[13px] pb-1 pt-[9px] text-[10px] font-semibold uppercase tracking-[.08em] text-dim2';
const noteCls = 'border-t border-line px-[13px] py-2 text-[11px] text-dim';

export function SearchBox() {
  const fmt = useMoney();
  const bounds = useApp(s => s.bounds);
  const cascade = useApp(s => s.cascade);
  const gkey = useApp(s => s.gkey);
  const popColors = useApp(s => s.popColors);
  const cctvList = useApp(s => s.cctvList);
  const sensList = useApp(s => s.sensList);
  const { query, online, onlineStale, dropOpen, lastFullBBox } = useSearch();
  const patch = useSearch(s => s.patch);

  const [value, setValue] = useState('');
  const [kb, setKb] = useState(-1);
  const ctl = useRef<AbortController | null>(null);
  const seq = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  /* ---------- run a search ---------- */
  const runSearch = useCallback((q: string, fresh: boolean) => {
    if (!q.trim()) { patch({ dropOpen: false, query: '' }); plotSearch([]); return; }
    patch({ query: q, dropOpen: true });
    if (!fresh) return;
    const map = getMap(); if (!map) return;
    const b = map.getBounds();
    const box: BBox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    const my = ++seq.current;
    ctl.current?.abort();
    const c = new AbortController(); ctl.current = c;
    patch({ onlineStale: false, lastFullBBox: box, online: { status: 'loading', list: [] } });
    const st = getApp();
    onlineSearch(q.trim().toLowerCase(), box, st.cascade, st.gkey, c.signal)
      .then(list => { if (my === seq.current) patch({ online: { status: 'done', list } }); })
      .catch((err: unknown) => {
        if (my !== seq.current || (err instanceof DOMException && err.name === 'AbortError')) return;
        patch({ online: { status: 'error', list: [] } });
      });
  }, [patch]);
  const debounced = useMemo(() => debounce((q: string) => runSearch(q, true), 220), [runSearch]);

  const closeDrop = useCallback(() => { seq.current++; ctl.current?.abort(); patch({ dropOpen: false }); }, [patch]);

  /* ---------- local results follow the current bbox ---------- */
  const { rows, parcelRows, pinRows, onlineRows } = useMemo(() => {
    const t = query.trim().toLowerCase();
    const bb = bounds as BBox | null;
    const parcels: Row[] = [];
    if (t && bb) {
      for (const p of ALL_PARCELS) {
        if (parcels.length >= 8) break;
        if ((p.name.toLowerCase().includes(t) || p.deed.toLowerCase().includes(t) || p.province.includes(t)) && inBbox([p.lng, p.lat], bb)) {
          parcels.push({ rid: 'p' + p.id, kind: 'land', ll: [p.lng, p.lat], name: p.name, sub: fmt(p.price), dot: parcelDot(p), parcelId: p.id });
        }
      }
    }
    const pins: Row[] = t && bb ? matchPins(t, bb).map(h => ({ rid: 'c' + h.id, kind: h.kind as Row['kind'], ll: h.ll, name: h.name, sub: h.sub, hit: h })) : [];
    const onl: Row[] = !onlineStale && online.status === 'done'
      ? online.list.filter(x => bb && inBbox([x.lng, x.lat], bb)).map((x, i) => ({ rid: 'o' + i, kind: 'place' as const, ll: [x.lng, x.lat] as LngLat, name: x.name, sub: x.src, place: x }))
      : [];
    return { rows: [...parcels, ...pins, ...onl], parcelRows: parcels, pinRows: pins, onlineRows: onl };
    // cctvList / sensList are inputs of matchPins
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, bounds, online, onlineStale, fmt, popColors, cctvList, sensList]);

  /* result icons on the map */
  useEffect(() => {
    plotSearch(dropOpen ? rows.map(r => ({ id: r.rid, kind: r.kind, ll: r.ll })) : []);
  }, [rows, dropOpen]);

  /* once the view leaves the searched area, online results become an "area changed" note */
  useEffect(() => {
    if (!dropOpen || !query || !bounds) return;
    const stale = !centerInside(lastFullBBox, [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2]);
    if (stale !== onlineStale) patch({ onlineStale: stale });
  }, [bounds, dropOpen, query, lastFullBBox, onlineStale, patch]);

  /* ---------- pick ---------- */
  const pick = useCallback((r: Row) => {
    if (r.kind === 'place' && r.place) {
      showSearchPin(r.ll, poiIcon(r.place.cat), r.name, '#7FD4FF');
      getMap()?.flyTo({ center: r.ll, zoom: 14, duration: 900 });
      ringAt(r.ll);
      toast(`นำทางไปยัง ${r.name} · ${r.place.src}`);
    } else if (r.kind === 'land' && r.parcelId != null) {
      const p = PARCEL_BY_ID.get(r.parcelId); if (!p) return;
      showSearchPin([p.lng, p.lat], 'map-pin', p.name, ACCENT);
      select(p.id);
      ringAt([p.lng, p.lat]);
      setValue('');
    } else if (r.hit) gotoItem(r.hit);
    closeDrop();
    plotSearch([]);
  }, [closeDrop]);

  useEffect(() => {
    setSearchPickHandler(rid => { const r = rows.find(x => x.rid === rid); if (r) pick(r); });
    return () => setSearchPickHandler(null);
  }, [rows, pick]);

  /* outside click + "/" shortcut */
  useEffect(() => {
    const down = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) closeDrop(); };
    const key = (e: KeyboardEvent) => {
      if (e.key === '/' && !/input|select|textarea/i.test((document.activeElement?.tagName) ?? '')) { e.preventDefault(); input.current?.focus(); }
    };
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', down); document.removeEventListener('keydown', key); };
  }, [closeDrop]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!rows.length) return;
      e.preventDefault();
      setKb(k => (e.key === 'ArrowDown' ? Math.min(k + 1, rows.length - 1) : Math.max(k - 1, 0)));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const r = rows[kb] ?? rows[0];
      if (r) pick(r);
    } else if (e.key === 'Escape') { closeDrop(); input.current?.blur(); }
  };

  const source = cascade === 'google' && gkey ? 'Google' : 'Nominatim';
  const rowKb = (r: Row) => rows.indexOf(r) === kb;
  const pinIcon = (k: Row['kind']) => (k === 'cctv' ? <Video size={14} className="shrink-0 text-dim2" /> : k === 'transport' ? <Bus size={14} className="shrink-0 text-dim2" /> : <Waves size={14} className="shrink-0 text-dim2" />);

  return (
    <div ref={root} className="relative min-w-0 max-w-[520px] flex-1 max-[700px]:max-w-none">
      <div className="flex h-9 items-center gap-2 rounded-[9px] border border-line2 bg-bg px-2.5 focus-within:border-accent">
        <Search size={15} className="shrink-0 text-dim2" />
        <input
          ref={input}
          value={value}
          onChange={e => { setValue(e.target.value); setKb(-1); debounced(e.target.value); }}
          onFocus={() => { if (value.trim()) runSearch(value, true); }}
          onKeyDown={onKey}
          placeholder="ค้นหาเฉพาะในพื้นที่มองเห็น (bbox ปัจจุบัน)…"
          autoComplete="off"
          className="min-w-0 flex-1 border-none bg-transparent text-[12.5px] text-ink outline-none placeholder:text-dim2"
        />
        <kbd className="shrink-0 rounded-[5px] border border-b-2 border-line2 px-1.5 py-px font-display text-[10px] font-medium text-dim max-[700px]:hidden">/</kbd>
      </div>

      {dropOpen && (
        <div
          className="fs-panel absolute left-0 right-0 top-[calc(100%+6px)] z-[80] max-h-[380px] overflow-y-auto rounded-[11px] border border-line2 bg-panel shadow-[0_16px_40px_rgba(0,0,0,.55)]"
          onPointerDown={e => e.preventDefault()} /* keep focus in the input while clicking a result */
        >
          <div className={groupCls}><Database size={12} />ในระบบ · เฉพาะกรอบมองเห็น</div>
          {parcelRows.length ? parcelRows.map(r => (
            <div key={r.rid} className={rowCls(rowKb(r))} onClick={() => pick(r)}>
              <span className="inline-block size-[7px] shrink-0 rounded-full" style={{ background: r.dot }} />
              <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{r.name}</span>
              <span className="max-w-[130px] shrink-0 overflow-hidden text-ellipsis whitespace-nowrap font-display text-[10.5px] text-dim2">{r.sub}</span>
            </div>
          )) : <div className={noteCls}>ไม่พบแปลงในกรอบมองเห็นนี้</div>}

          {pinRows.length > 0 && (
            <>
              <div className={groupCls}><MapPin size={12} />หมุดบนแผนที่ · CCTV / เซ็นเซอร์</div>
              {pinRows.map(r => (
                <div key={r.rid} className={rowCls(rowKb(r))} onClick={() => pick(r)}>
                  {pinIcon(r.kind)}
                  <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{r.name}</span>
                  <span className="max-w-[130px] shrink-0 overflow-hidden text-ellipsis whitespace-nowrap font-display text-[10.5px] text-dim2">{r.sub}</span>
                </div>
              ))}
            </>
          )}

          <div className={groupCls}><Globe size={12} />ออนไลน์ · เฉพาะกรอบมองเห็น · {source}</div>
          {onlineStale ? <div className={noteCls}>พื้นที่มองเห็นเปลี่ยน — กดปุ่ม "ค้นหา" บนแผนที่เพื่อค้นหาในพื้นที่ใหม่</div>
            : online.status === 'loading' ? (
              <div className={rowCls(false)}><span className="spin-keep inline-block size-3 flex-none animate-spin2 rounded-full border-2 border-line2 border-t-accent" /><span className="text-dim">กำลังค้นหาออนไลน์…</span></div>
            ) : online.status === 'error' ? <div className={rowCls(false)}><span className="text-dim">ค้นหาออนไลน์ล้มเหลว — ลองอีกครั้ง</span></div>
              : onlineRows.length ? onlineRows.map(r => (
                <div key={r.rid} className={rowCls(rowKb(r))} onClick={() => pick(r)}>
                  <MapPin size={14} className="shrink-0 text-dim2" />
                  <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap" data-tip={esc(r.name)}>{r.name}</span>
                  <span className="max-w-[130px] shrink-0 overflow-hidden text-ellipsis whitespace-nowrap font-display text-[10.5px] text-dim2">{r.sub}</span>
                </div>
              )) : <div className={noteCls}>ไม่พบสถานที่ออนไลน์ในกรอบมองเห็นนี้</div>}
        </div>
      )}
    </div>
  );
}

export { currentBbox };
