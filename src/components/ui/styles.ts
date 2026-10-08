/** Shared Tailwind class bundles for primitives used across many components. */
export const btn =
  'inline-flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg border border-line2 bg-panel2 px-[11px] py-1.5 text-xs font-medium text-ink transition hover:border-dim2 hover:bg-[#1E241E] disabled:cursor-default disabled:opacity-60';
export const btnAcc =
  'inline-flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg border border-accent bg-accent px-[11px] py-1.5 text-xs font-semibold text-accent-ink transition hover:border-[#C9FA57] hover:bg-[#C9FA57] disabled:cursor-default disabled:opacity-60';
export const btnOn = 'border-accent text-accent';

export const iconBtn =
  'grid size-[31px] shrink-0 cursor-pointer place-items-center rounded-lg border border-transparent bg-transparent text-dim transition hover:bg-panel2 hover:text-ink';

export const inp =
  'w-full rounded-[7px] border border-line2 bg-bg px-2 py-[5px] text-[11.5px] text-ink outline-none placeholder:text-dim2 focus:border-accent';

export const frow = 'flex flex-wrap items-center gap-2.5 border-b border-line py-2.5';
export const fl = 'min-w-0 flex-1 text-[12.5px]';
export const hint = 'py-[9px] text-[10.5px] leading-[1.6] text-dim2';
export const setSec = 'mb-0.5 mt-4 text-[10.5px] font-semibold uppercase tracking-[.1em] text-dim first:mt-0';
export const detSub = 'mb-[7px] mt-3.5 text-[10.5px] font-semibold uppercase tracking-[.1em] text-dim';
export const resCap = 'pt-2 text-[10.5px] text-dim2';

export const pillCls = (on: boolean, square = false): string =>
  `cursor-pointer border px-2.5 py-1 text-[11px] font-medium transition ${square ? 'rounded-lg' : 'rounded-full'} ${
    on ? 'border-accent bg-accent-dim text-accent' : 'border-line2 bg-bg text-dim'
  }`;

export const pickBtn =
  'inline-flex min-w-[112px] cursor-pointer items-center gap-1.5 rounded-lg border border-line2 bg-bg px-[9px] py-[5px] text-[11.5px] text-ink hover:border-dim2';

export const menuBox =
  'fixed z-[96] max-h-[300px] min-w-[150px] animate-tin overflow-y-auto rounded-[11px] border border-line2 bg-panel p-[5px] shadow-[0_18px_44px_rgba(0,0,0,.55)]';
export const menuItem = (on: boolean): string =>
  `flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-[7px] px-[9px] py-[7px] text-xs hover:bg-panel2 ${on ? 'bg-accent-dim text-accent' : ''}`;

export const stDot = 'inline-block size-[7px] shrink-0 rounded-full';
export const popupBox =
  'fixed z-[97] animate-tin rounded-xl border border-line2 bg-panel p-2.5 shadow-[0_18px_44px_rgba(0,0,0,.55)]';
export const lpBadge =
  'shrink-0 rounded-md border border-line2 bg-[#0C0E0C] px-[7px] py-0.5 font-display text-[10px] font-bold leading-[1.3] text-white';
