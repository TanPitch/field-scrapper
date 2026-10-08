import type { ReactNode } from 'react';

export const VPad = ({ children }: { children: ReactNode }) => <div className="px-3.5 py-3">{children}</div>;

/** Sticky intro strip used at the top of list views. */
export const VStats = ({ children }: { children: ReactNode }) => (
  <div className="sticky top-0 z-[2] -mx-3.5 -mt-3 mb-2.5 border-b border-line bg-panel px-3.5 py-[11px] text-xs text-dim">{children}</div>
);
export const VSticky = ({ children }: { children: ReactNode }) => (
  <div className="sticky top-0 z-[3] border-b border-line bg-panel px-3.5 pb-2.5 pt-[11px]">{children}</div>
);

export const Chip = ({ children, bg, ink }: { children: ReactNode; bg: string; ink: string }) => (
  <span className="rounded-full px-[9px] py-0.5 text-[10px] font-semibold" style={{ background: bg, color: ink }}>{children}</span>
);
export const DetTop = ({ children }: { children: ReactNode }) => <div className="mb-[5px] flex items-center gap-2">{children}</div>;
export const DetName = ({ children }: { children: ReactNode }) => <div className="text-[14.5px] font-semibold leading-[1.4]">{children}</div>;
export const DetSub = ({ children, first = false }: { children: ReactNode; first?: boolean }) => (
  <div className={`mb-[7px] text-[10.5px] font-semibold uppercase tracking-[.1em] text-dim ${first ? 'mt-0' : 'mt-3.5'}`}>{children}</div>
);
export const DetRows = ({ rows, className = '' }: { rows: [string, ReactNode][]; className?: string }) => (
  <div className={className}>
    {rows.map(([k, v]) => (
      <div key={k} className="flex justify-between gap-3.5 border-t border-line py-[5px] text-[11.5px]">
        <span className="text-dim">{k}</span>
        <b className="text-right font-medium">{v}</b>
      </div>
    ))}
  </div>
);
export const ResCap = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <div className={`pt-2 text-[10.5px] text-dim2 ${className}`}>{children}</div>
);
export const Hint = ({ children }: { children: ReactNode }) => <div className="py-[9px] text-[10.5px] leading-[1.6] text-dim2">{children}</div>;
export const LpBadge = ({ children, red = false }: { children: ReactNode; red?: boolean }) => (
  <span className={`shrink-0 rounded-md border bg-[#0C0E0C] px-[7px] py-0.5 font-display text-[10px] font-bold leading-[1.3] ${red ? 'border-[rgba(255,122,107,.45)] text-danger' : 'border-line2 text-white'}`}>{children}</span>
);
export const rowIcon = 'grid size-6 shrink-0 cursor-pointer place-items-center rounded-[7px] border border-transparent text-dim transition hover:bg-panel2 hover:text-ink';
export const drowCls = (editing = false) =>
  `mb-1.5 ml-1.5 flex cursor-pointer items-center gap-[7px] rounded-[9px] border py-2 pl-1.5 pr-2.5 text-xs transition hover:border-accent ${editing ? 'border-accent bg-accent-dim' : 'border-line'}`;
export const emptyNote = 'pb-2 pt-0.5 text-[10.5px] text-dim2';
