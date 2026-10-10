import {
  Bot, Crown, DollarSign, House, Leaf, PartyPopper, PiggyBank, ShoppingBag, Upload, User, X,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from '../../store/useApp';
import { btn, btnAcc } from './styles';
import { ColorButton } from './ColorButton';

/**
 * Explicit keys — lucide icons are `forwardRef` objects exposing `displayName`,
 * not `name`, so the key cannot be read back off the component.
 */
const ICONS = [
  { key: 'user', th: 'ผู้ใช้', Icon: User },
  { key: 'house', th: 'บ้าน', Icon: House },
  { key: 'bot', th: 'บอท', Icon: Bot },
  { key: 'crown', th: 'มงกุฎ', Icon: Crown },
  { key: 'leaf', th: 'ใบไม้', Icon: Leaf },
  { key: 'party-popper', th: 'ปาร์ตี้', Icon: PartyPopper },
  { key: 'shopping-bag', th: 'กระเป๋า', Icon: ShoppingBag },
  { key: 'piggy-bank', th: 'กระปุก', Icon: PiggyBank },
  { key: 'dollar-sign', th: 'ดอลลาร์', Icon: DollarSign },
] as const;

export interface AvatarCfg {
  /** One of the `ICONS` keys, ignored when `image` is set. */
  icon: string;
  /** 1 colour = solid, 2 = gradient. */
  from: string;
  to: string;
  /** data-URL of an uploaded image; wins over icon/colour when present. */
  image: string;
}

export const emptyAvatar: AvatarCfg = { icon: 'user', from: '#4C9AFF', to: '', image: '' };

/** Solid with one colour, gradient when a second is set. */
export const avatarCss = (a: AvatarCfg): string =>
  a.to && a.to !== a.from
    ? `linear-gradient(135deg, ${a.from}, ${a.to})`
    : a.from || 'var(--accent)';

export const avatarIcon = (key?: string) =>
  ICONS.find(i => i.key === key)?.Icon ?? User;

/** The round preview itself — deliberately not clickable; the button opens the panel. */
export function AvatarPreview({ cfg, size = 52 }: { cfg: AvatarCfg; size?: number }) {
  const c = cfg ?? emptyAvatar;
  return (
    <div
      className="grid flex-none place-items-center overflow-hidden rounded-full"
      style={{ width: size, height: size, background: c.image ? 'var(--panel2)' : avatarCss(c) }}
    >
      {c.image
        ? <img src={c.image} alt="" className="size-full object-cover" />
        : (() => { const I = avatarIcon(c.icon); return <I size={size * 0.46} className="text-white" strokeWidth={2} />; })()}
    </div>
  );
}

/**
 * "เปลี่ยนรูป" trigger + an anchored panel for colour, icon and upload.
 * The panel is positioned under the button rather than centred over the screen,
 * so the rest of the form stays readable.
 */
export function AvatarPicker({ cfg, onChange, label = 'เปลี่ยนรูป' }: {
  cfg: AvatarCfg;
  onChange: (next: AvatarCfg) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const c = cfg ?? emptyAvatar;

  return (
    <div ref={wrap} className="relative flex-none">
      <button className={`${btnAcc} cursor-pointer`} onClick={() => setOpen(v => !v)}>
        <CameraGlyph />{label}
      </button>

      {open && (
        <>
          {/* click-away shield; the panel itself stops propagation */}
          <div className="fixed inset-0 z-[360]" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-[calc(100%+6px)] z-[370] w-[248px] rounded-[12px] border border-line2 bg-panel p-3 shadow-[0_18px_44px_rgba(0,0,0,.55)]">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-semibold">รูปโปรไฟล์</span>
              <button className="cursor-pointer text-dim2 transition hover:text-ink" onClick={() => setOpen(false)}><X size={14} /></button>
            </div>

            <div className="mt-3 flex items-center gap-2.5">
              <AvatarPreview cfg={c} size={44} />
              <div className="flex flex-1 items-center gap-2">
                <ColorButton
                  title="สีที่ 1"
                  value={c.from}
                  onChange={hex => onChange({ ...c, from: hex })}
                  className="h-8 w-8 flex-none cursor-pointer rounded-lg border border-line2 p-0"
                  style={{ background: c.from }}
                />
                <span className="text-[10.5px] text-dim2">สี 1</span>
                <ColorButton
                  title="สีที่ 2 (ไล่เฉด)"
                  value={c.to || c.from}
                  onChange={hex => onChange({ ...c, to: hex === c.from ? '' : hex })}
                  className="h-8 w-8 flex-none cursor-pointer rounded-lg border border-line2 p-0"
                  style={{ background: c.to || c.from }}
                />
                <span className="text-[10.5px] text-dim2">สี 2</span>
              </div>
            </div>
            <p className="mt-1.5 text-[10px] text-dim2">
              เลือกสีเดียว = สีทึบ · เลือกสองสี = ไล่เฉด{c.to ? '' : ' (กดสี 2 เพื่อเปิดไล่เฉด)'}
            </p>

            <div className="mt-2.5 grid grid-cols-5 gap-1.5">
              {ICONS.map(({ key, th, Icon }) => (
                <button
                  key={key}
                  title={th}
                  onClick={() => onChange({ ...c, icon: key, image: '' })}
                  className={`grid h-9 cursor-pointer place-items-center rounded-[8px] border transition ${
                    !c.image && c.icon === key
                      ? 'border-accent bg-accent-dim text-accent'
                      : 'border-line2 bg-bg text-dim hover:text-ink'
                  }`}
                >
                  <Icon size={15} />
                </button>
              ))}
            </div>

            <div className="mt-3 flex gap-1.5">
              <button className={`${btn} flex-1 cursor-pointer justify-center`} onClick={() => file.current?.click()}>
                <Upload size={12} />อัปโหลด
              </button>
              {c.image && (
                <button className={`${btn} cursor-pointer`} onClick={() => onChange({ ...c, image: '' })}>ใช้ไอคอน</button>
              )}
            </div>
            <input
              ref={file}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0];
                if (!f) return;
                const r = new FileReader();
                r.onload = () => { onChange({ ...c, image: String(r.result ?? '') }); toast('อัปเดตรูปโปรไฟล์แล้ว'); };
                r.readAsDataURL(f);
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}

const CameraGlyph = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
    <circle cx="12" cy="13" r="3" />
  </svg>
);
