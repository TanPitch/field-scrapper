import type { ReactNode } from 'react';
import { useMoney } from '../../hooks/useMoney';
import { numDate } from '../../lib/format';
import { discountBadge, nextRoundPrice, startPriceOf } from '../../lib/price';
import { useApp } from '../../store/useApp';
import type { Parcel } from '../../types';
import { useTipProps } from '../ui/Tip';

/**
 * The price block, used by the detail panel and both popup kinds so the three
 * never drift apart.
 *
 * Reading order is deliberate: the number you would actually pay is large, and
 * the starting price is demoted to a struck-through aside. Showing the start
 * price as the headline — which is what this used to do — reads as "this is
 * the price" and quietly overstates every lot that has already come down.
 *
 * `compact` drops the date line, for popups with no room for it.
 */
export function PriceHeadline({
  p,
  compact = false,
  now = Date.now(),
}: {
  p: Parcel;
  compact?: boolean;
  now?: number;
}) {
  const fmt = useMoney();
  /* Sold lots' headline arrangement (setting: แผงรายละเอียด → ราคาแปลงที่ขายแล้ว).
     Read before the early return below — hooks must run unconditionally. */
  const soldBig = useApp(s => s.soldPriceHeadline);
  const next = nextRoundPrice(p, now);
  const perWah = p.perWah || p.td?.perSqWa;
  /* LED's committee figure (ราคาที่กำหนดโดยคณะกรรมการกำหนดราคาทรัพย์) is the
     number the user reads as THE price — ผบ.2545/2562's relisted floor is
     80,177,600 while LED's committee value is 98,329,928 — so when the ledger
     carries it (liveData merges led_price-first into committeePrice), it leads
     and the round ladder demotes to context. The discount badge keeps
     describing the next round against its opening. Sold lots skip it: their
     headline is the winning bid, which p.price already carries. */
  const committee = p.committeePrice != null && p.committeePrice > 0 ? p.committeePrice : null;

  /* Sold, or no future round scheduled: there is no next-round price to lead
     with, so fall back to the latest known price rather than inventing one.
     A sold lot (ledger carries the winning bid) may swap which figure is large,
     per the soldPriceHeadline setting — only ever these two numbers, and only
     for land that actually sold; an unsynced sold lot (soldPrice null) keeps
     the single number it always had rather than dressing the floor up as a
     result. The open price is the same announce anchor startPriceOf() reads:
     LED's committee figure when it has one, else the scraped start price. */
  if (!next) {
    const open = startPriceOf(p);
    const hasOpen = open > 0 && open !== p.price;
    if (p.soldPrice != null && soldBig === 'open' && hasOpen) {
      return (
        <div>
          <div className="text-2xl font-bold text-accent">{fmt(open)}</div>
          <div className="mb-2.5 font-display text-[11px] text-dim">
            ราคาขายได้ {fmt(p.price)}
            {perWah ? <> · {fmt(perWah)} / ตร.วา</> : null}
          </div>
        </div>
      );
    }
    return (
      <div>
        <div className="text-2xl font-bold text-accent">{fmt(p.price)}</div>
        {p.soldPrice != null && hasOpen && (
          <div className="mb-2.5 font-display text-[11px] text-dim">ราคาเปิด {fmt(open)}</div>
        )}
        <div className="mb-2.5 font-display text-[11px] text-dim">
          {perWah ? `${fmt(perWah)} / ตร.วา` : null}
        </div>
      </div>
    );
  }

  const badge = discountBadge(next.discountPct);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <div className="text-2xl font-bold text-accent">{fmt(committee ?? next.price)}</div>
        {badge && (
          <span
            {...useTipProps(`รอบถัดไปลด ${Math.round(next.discountPct)}%`)}
            className="flex items-center justify-center rounded-full border border-accent/40 bg-[#E5484D] px-[7px] py-[1px] font-display text-[11px] font-semibold text-white"
          >
            {badge}
          </span>
        )}
      </div>

      {/* Start price, struck through and dimmed — context for the discount, not
          a second headline. Hidden when no discount applies, since an unchanged
          struck-through number reads as "already reduced" — and hidden when it
          just repeats the big number: the committee-led anchor makes
          next.startPrice equal the headline on lots like ผบ.2545, and printing
          one figure twice teaches nothing. */}
      {next.discountPct > 0 && next.startPrice !== committee && (
        <div className="mt-0.5 flex items-baseline gap-1.5 text-[11.5px] text-dim2 opacity-70">
          <span className="font-display text-[10.5px]">ราคาเปิด</span>
          <span>{fmt(next.startPrice)}</span>
        </div>
      )}

      <div className="mb-2.5 font-display text-[11px] text-dim">
        {perWah ? `${fmt(perWah)} / ตร.วา` : null}
        {compact || next.date == null ? null : <> · รอบ {numDate(next.date)}</>}
      </div>
    </div>
  );
}

/** Small price cell for tables: next-round price, with the start price dimmed
 *  beneath when it has dropped. Keeps `PriceHeadline`'s rule in one place. */
export function PriceCell({ p, now = Date.now() }: { p: Parcel; now?: number }) {
  const fmt = useMoney();
  const next = nextRoundPrice(p, now);
  if (!next) return <span>{fmt(p.price)}</span>;
  return (
    <span className="flex flex-col leading-tight">
      <span>{fmt(next.price)}</span>
      {next.discountPct > 0 && (
        <span className="text-[10px] text-dim2 opacity-70 line-through">{fmt(next.startPrice)}</span>
      )}
    </span>
  );
}

/** กรมธนารักย์ per-parcel assessment, with its ราคาประเมิน caveat kept next to
 *  it. Returns null when there is no TD figure, so the caller omits the row
 *  rather than showing an empty one. */
export function TdPriceRow({ p, children }: { p: Parcel; children?: ReactNode }) {
  const fmt = useMoney();
  const eva = p.td?.perSqWa ?? null;
  if (eva == null) return null;
  return (
    <>
      <span className="text-dim">ราคาประเมิน (กรมธนารักย์)</span>
      <b className="text-right font-medium">
        {fmt(eva)} / ตร.วา
        {children}
      </b>
    </>
  );
}
