import { Bus, Database, Globe, MapPin, Search, Video, Waves, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ALL_PARCELS, PARCEL_BY_ID } from '../../data/liveData';
import { useMoney } from '../../hooks/useMoney';
import { esc, debounce, fmtRai } from '../../lib/format';
import { parcelDot } from '../../lib/parcelColor';
import { onlineSearch, poiIcon } from '../../lib/onlineSearch';
import { getMap } from '../../map/mapRef';
import { currentBbox, flyToResult, gotoItem, inBbox, matchPins, plotSearch, setSearchPickHandler, setSearchSelection } from '../../map/pins';
import { select, showRight } from '../../store/actions';
import { getApp, toast, useApp } from '../../store/useApp';
import { centerInside, useSearch, type OnlinePlace, type SearchRow } from '../../store/useSearch';
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

/** Panel-facing projection of a dropdown row. */
const toStoreRow = (r: Row): SearchRow => ({
  id: r.rid, kind: r.kind, name: r.name, sub: r.sub, lng: r.ll[0], lat: r.ll[1],
  dot: r.dot, parcelId: r.parcelId, place: r.place,
});

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
  const { query, online, onlineStale, dropOpen, lastFullBBox, wide } = useSearch();
  const patch = useSearch(s => s.patch);

  const [value, setValue] = useState('');
  const [kb, setKb] = useState(-1);
  const ctl = useRef<AbortController | null>(null);
  const seq = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  /* searching also opens ผลการค้นหา in the right panel */
  const openResults = useCallback(() => showRight('results'), []);

/* One clear-path that owns every surface: the dropdown, the right panel and
 * the internet-hit markers. The old path left the store's online list as it
 * was — the next render rebuilt online rows from it, re-plotted the markers
 * and repopulated rows behind the emptied box. Clearing also aborts the
 * in-flight online fetch, because a response landing after the clear is as
 * stale as the text that provoked it. */
const runSearch = useCallback((q: string, fresh: boolean, drop = true) => {
  if (!q.trim()) {
    seq.current++;
    ctl.current?.abort();
    patch({
      dropOpen: false, query: '', rows: [], wide: false,
      online: { status: 'done', list: [] }, onlineStale: false, lastFullBBox: null,
    });
    setSearchSelection(null);
    plotSearch([]);
    return;
  }
    /* Each fresh run starts bbox-scoped again; the "ค้นในทุกพื้นที่" button is
       opt-in per search, and a new query must not inherit the last one's scope. */
    patch({ query: q, dropOpen: drop, wide: false });
    if (!fresh) return;
    openResults();
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
  }, [patch, openResults]);
  const debounced = useMemo(() => debounce((q: string) => runSearch(q, true), 400), [runSearch]);

  /* the map overlay button re-runs whatever is currently typed, results going to
     ผลการค้นหา only — the title-bar dropdown stays closed */
  useEffect(() => {
    patch({ rerun: () => { if (value.trim()) runSearch(value, true, false); } });
  }, [value, runSearch, patch]);

const closeDrop = useCallback(() => { seq.current++; ctl.current?.abort(); patch({ dropOpen: false }); }, [patch]);

  /* ---------- local results follow the current bbox ---------- */
  /* Results are a snapshot of the bbox at search time: panning the map must NOT
     re-filter them, or the list would empty out as soon as you move. `bounds`
     is intentionally absent from the deps. */
  const frozenBBox = useRef<BBox | null>(null);
  useEffect(() => { if (!frozenBBox.current) frozenBBox.current = bounds as BBox | null; }, [bounds]);
  useEffect(() => {
    if (bounds && useSearch.getState().lastFullBBox) frozenBBox.current = bounds as BBox;
  }, [bounds, query]);

  const { rows, parcelRows, pinRows, onlineRows, hiddenParcels } = useMemo(() => {
    const t = query.trim().toLowerCase();
    const bb = frozenBBox.current as BBox | null;
    const limit = getApp().searchLimit;
    /* Case numbers carry a season and letters both above and below the slash
       (ผบ.754/2562, ผบE.4642/2568), so the match is the same substring test the
       name/deed probes use, against LED's own `ผบ../ปี` string. The sides are
       compared with every whitespace removed, because "ผบ.1664 / 2562" typed
       with the space that a human writes around the slash must meet LED's
       unspaced `ผบ.1664/2562` — collapsing runs of spaces cannot bleed into
       the other probes, which still compare on the exact trimmed text. */
    const caseKey = (s: string): string => s.toLowerCase().replace(/\s+/g, '');
    const tl = caseKey(t);
    const match = (p: typeof ALL_PARCELS[number]): boolean =>
      p.name.toLowerCase().includes(t) || p.deed.toLowerCase().includes(t)
      || p.province.includes(t) || caseKey(p.caseNo).includes(tl);
    /* Parcel hits are bbox-scoped first. When none land in view, the dropdown
       offers the out-of-view matches (hiddenParcels) behind one button instead
       of silently showing "ไม่พบ" — the land may be real, just off-screen. */
    const parcels: Row[] = [];
    let hiddenParcels = 0;
    if (t) {
      for (const p of ALL_PARCELS) {
        if (!match(p)) continue;
        const inArea = !bb || inBbox([p.lng, p.lat], bb);
        /* The row read is the case the land belongs to, where it is, how big
           and what LED opens the bidding at — a price alone made every row look
           alike and forced the deed-hunt loop into the detail panel. caseNo is
           the exact string LED publishes (ผบ../2569), so the row and the query
           can meet mid-string. */
        const row: Row = {
          rid: 'p' + p.id, kind: 'land', ll: [p.lng, p.lat], name: `${p.caseNo} · ${p.propertyType}`,
          sub: `${p.tambon} ${p.amp} ${p.province} · ${fmtRai(p.wah, p.sizeUnit)}`,
          dot: parcelDot(p), parcelId: p.id,
        };
        if ((wide || inArea) && parcels.length < limit) parcels.push(row);
        else if (!inArea) hiddenParcels++;
      }
    }
    const pins: Row[] = t && bb ? matchPins(t, bb).slice(0, limit).map(h => ({ rid: 'c' + h.id, kind: h.kind as Row['kind'], ll: h.ll, name: h.name, sub: h.sub, hit: h })) : [];
    const onl: Row[] = online.status === 'done'
      ? online.list.filter(x => bb && inBbox([x.lng, x.lat], bb)).slice(0, limit).map((x, i) => ({ rid: 'o' + i, kind: 'place' as const, ll: [x.lng, x.lat] as LngLat, name: x.name, sub: x.src, place: x }))
      : [];
    return { rows: [...parcels, ...pins, ...onl], parcelRows: parcels, pinRows: pins, onlineRows: onl, hiddenParcels };
    // cctvList / sensList are inputs of matchPins
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, online, fmt, popColors, cctvList, sensList, wide]);

/* Only internet hits get a marker. Land parcels, cctv, water and bus already have
     their own markers on the map — plotting them again would stack a duplicate
     on top of each one. */
useEffect(() => {
  plotSearch(rows.filter(r => r.kind === 'place').map(r => ({ id: r.rid, kind: r.kind, ll: r.ll, ic: poiIcon(r.place?.cat) })));
  patch({ rows: rows.map(toStoreRow) });
}, [rows, patch]);

  /* a cleared query must clear the panel list too */
  useEffect(() => { if (!query.trim() && useSearch.getState().rows.length) patch({ rows: [] }); }, [query, patch]);

  /* once the view leaves the searched area, prompt for a re-search — but the result
     list itself stays as-is until the user asks for a new search */
  useEffect(() => {
    if (!dropOpen || !query || !bounds) return;
    const stale = !centerInside(lastFullBBox, [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2]);
    if (stale !== onlineStale) patch({ onlineStale: stale });
  }, [bounds, dropOpen, query, lastFullBBox, onlineStale, patch]);

/* ---------- pick ---------- */
  const pick = useCallback((r: Row) => {
    if (r.kind === 'place') {
      /* Internet hit: ring the marker that is already on the map. No extra marker,
         no separate right panel — the search list stays where it is. */
      setSearchSelection(r.rid);
      flyToResult(r.ll);
      toast(`นำทางไปยัง ${r.name} · ${r.place?.src ?? ''}`);
    } else {
      /* Local hit: ring is handled by that marker's own panel + selection, and
         the results list is replaced by the marker's panel. */
      setSearchSelection(null);
      if (r.kind === 'land' && r.parcelId != null) {
        const p = PARCEL_BY_ID.get(r.parcelId); if (!p) return;
        select(p.id);
      } else if (r.hit) gotoItem(r.hit, false);
    }
    closeDrop();
  }, [closeDrop]);

  useEffect(() => {
    setSearchPickHandler(rid => { const r = rows.find(x => x.rid === rid); if (r) pick(r); });
    patch({ onPick: rid => { const r = rows.find(x => x.rid === rid); if (r) pick(r); } });
    return () => setSearchPickHandler(null);
  }, [rows, pick, patch]);

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
          onChange={e => {
            const v = e.target.value;
            setValue(v); setKb(-1);
            /* Anything that empties the box — the ✕ button, backspace, select
               all + delete, IME cleanup — must not leave a 400 ms window in
               which the previous phrase could still reach the search once, and
               must not WAIT for the debounce to decide the clear: reset the
               surfaces the moment the text is gone. */
            if (!v.trim()) { debounced.cancel(); runSearch('', true); }
            else debounced(v);
          }}
          onFocus={() => { if (value.trim()) runSearch(value, true); }}
          onKeyDown={onKey}
          placeholder="ค้นหา"
          autoComplete="off"
          className="min-w-0 flex-1 self-center border-none bg-transparent text-[12.5px] leading-none text-ink outline-none placeholder:text-dim2"
        />
        {value && (
          <button
            type="button"
            aria-label="ล้างคำค้น"
            onClick={() => { setValue(''); setKb(-1); debounced.cancel(); runSearch('', true); closeDrop(); input.current?.focus(); }}
            className="grid size-[18px] shrink-0 cursor-pointer place-items-center rounded-full text-dim2 transition hover:bg-panel2 hover:text-ink"
          >
            <X size={12} />
          </button>
        )}
        <kbd className="shrink-0 rounded-[5px] border border-b-2 border-line2 px-1.5 py-px font-display text-[10px] font-medium text-dim max-[700px]:hidden">/</kbd>
      </div>

      {dropOpen && (
        <div
          className="fs-panel absolute left-0 right-0 top-[calc(100%+6px)] z-[80] max-h-[380px] overflow-y-auto rounded-[11px] border border-line2 bg-panel shadow-[0_16px_40px_rgba(0,0,0,.55)]"
          onPointerDown={e => e.preventDefault()} /* keep focus in the input while clicking a result */
        >
          <div className={`${groupCls} sticky top-0 bg-panel`}><Database size={12} />ในระบบ{wide ? ' · ทุกพื้นที่' : ' · พื้นที่ที่เห็น'}</div>
          {parcelRows.length ? parcelRows.map(r => (
            <div key={r.rid} className={rowCls(rowKb(r))} onClick={() => pick(r)}>
              <span className="inline-block size-[7px] shrink-0 rounded-full" style={{ background: r.dot }} />
              <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{r.name}</span>
              <span className="max-w-[300px] shrink-0 overflow-hidden text-ellipsis whitespace-nowrap font-display text-[10.5px] text-dim2" data-tip={esc(r.sub)}>{r.sub}</span>
            </div>
          )) : hiddenParcels > 0 ? (
            <button
              type="button"
              className="w-full cursor-pointer border-t border-none px-[13px] py-2 text-left text-[11.5px] text-accent transition hover:bg-panel2"
              onClick={() => patch({ wide: true })}
            >
              ไม่พบในพื้นที่ที่แสดง — ค้นในทุกพื้นที่ ({hiddenParcels} แปลง)
            </button>
          ) : <div className={noteCls}>ไม่พบสถานที่</div>}

          {pinRows.length > 0 && (
            <>
              <div className={`${groupCls} sticky top-0 bg-panel`}><MapPin size={12} />หมุดบนแผนที่ · CCTV / เซ็นเซอร์</div>
              {pinRows.map(r => (
                <div key={r.rid} className={rowCls(rowKb(r))} onClick={() => pick(r)}>
                  {pinIcon(r.kind)}
                  <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{r.name}</span>
                  <span className="max-w-[130px] shrink-0 overflow-hidden text-ellipsis whitespace-nowrap font-display text-[10.5px] text-dim2">{r.sub}</span>
                </div>
              ))}
            </>
          )}

          <div className={`${groupCls} sticky top-0 bg-panel`}><Globe size={12} />ออนไลน์ · {source}</div>
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
              )) : <div className={noteCls}>ไม่พบสถานที่</div>}
        </div>
      )}
</div>
  );
}

export { currentBbox };

/** Re-runs the current title-bar text against the current bbox. */
export function rerunSearch(): void {
  useSearch.getState().rerun?.();
}
