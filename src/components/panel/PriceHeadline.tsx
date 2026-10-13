import type { ReactNode } from 'react';
import { useMoney } from '../../hooks/useMoney';
import { numDate } from '../../lib/format';
import { discountBadge, nextRoundPrice } from '../../lib/price';
import type { Parcel } from '../../types';

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
  const next = nextRoundPrice(p, now);
  const perWah = p.perWah;

  /* Sold, or no future round scheduled: there is no next-round price to lead
     with, so fall back to the latest known price rather than inventing one. */
  if (!next) {
    return (
      <div>
        <div className="text-2xl font-bold text-accent">{fmt(p.price)}</div>
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
        <div className="text-2xl font-bold text-accent">{fmt(next.price)}</div>
        {badge && (
          <span
            title={`รอบถัดไปลดจากราคาเปิด ${Math.round(next.discountPct)}%`}
            className="rounded-full border border-[#3F6B2A] bg-[#1B2A12] px-[7px] py-[1px] font-display text-[11px] font-semibold text-[#B8F13F]"
          >
            {badge}
          </span>
        )}
      </div>

      {/* Start price, struck through and dimmed — context for the discount, not
          a second headline. Hidden when no discount applies, since an unchanged
          struck-through number reads as "already reduced". */}
      {next.discountPct > 0 && (
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
