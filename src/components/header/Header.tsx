import { useEffect } from 'react';
import { Info, LogOut, Map as MapIcon, Server, User, Users, Menu, Grid2x2, Palette, PanelLeft, PanelRight, PenTool, Search, Settings2, X, type LucideIcon } from 'lucide-react';
import { useTipProps } from '../ui/Tip';
import { useRef } from 'react';
import { setLeft, setRight } from '../../store/actions';
import { patchApp, toast, useApp, type SetTab } from '../../store/useApp';
import { useOutsideClose } from '../../hooks/useOutsideClose';
import { iconBtn } from '../ui/styles';
import { SearchBox } from './SearchBox';
import { AboutPane, DrawSettingsPane, LookPane, MapPane, PopupPane, SearchApiPane } from './settings/panes';
import { ServerPane } from './settings/ServerPane';
import { UserPane } from './settings/UserPane';
import { UserManagePane } from './settings/UserManagePane';

const TABS: { id: SetTab; label: string; Icon: LucideIcon }[] = [
  { id: 'user', label: 'ผู้ใช้', Icon: User },
  { id: 'map', label: 'แผนที่', Icon: MapIcon },
  { id: 'look', label: 'รูปลักษณ์', Icon: Palette },
  { id: 'popup', label: 'ที่ดิน', Icon: Grid2x2 },
  { id: 'draw', label: 'รูปวาด', Icon: PenTool },
  { id: 'search', label: 'ค้นหา & API', Icon: Search },
  { id: 'server', label: 'เซิร์ฟเวอร์', Icon: Server },
  { id: 'users', label: 'จัดการผู้ใช้', Icon: Users },
  { id: 'about', label: 'เกี่ยวกับ', Icon: Info },
];

/** Tabs only an admin may open. Gated on the account's role, which the server
 *  sets — not on a local unlock code.
 *
 *  A code typed into the app is not access control: it ships in the bundle and
 *  anyone can read it out of the JavaScript. Role is the only thing here that is
 *  actually enforced somewhere else. */
const ADMIN_ONLY: SetTab[] = ['users'];

function SettingsPanel({ onClose }: { onClose: () => void }) {
  const tab = useApp(s => s.setTab);
  const glassLevel = useApp(s => s.glassLevel);
  const role = useApp(s => s.role);
  const isAdmin = role === 'admin';
  const tabs = TABS.filter(t => !ADMIN_ONLY.includes(t.id) || isAdmin);

  /* If the signed-in user is not an admin, the pane must not stay parked on a
     tab they cannot see. */
  useEffect(() => {
    if (!ADMIN_ONLY.includes(tab) || isAdmin) return;
    patchApp({ setTab: 'map' });
  }, [tab, isAdmin]);
  return (
    <div className={`fs-panel absolute right-2.5 top-[calc(100%+8px)] z-[85] h-[calc(100vh-var(--header-h)-20px)] w-[640px] max-w-[calc(100vw-20px)] isolate animate-tin overflow-hidden rounded-[14px] border border-line2 shadow-[0_22px_60px_rgba(0,0,0,.6)] ${glassLevel === 'none' ? 'bg-panel' : 'bg-[rgba(18,21,18,.82)] backdrop-blur-md'}`}>
      <div className="relative z-10 flex h-full flex-col">
      <div className="flex items-center border-b border-line px-4 py-3 text-[13px] font-semibold">
        ตั้งค่าทั่วไป
        <button className={`${iconBtn} ml-auto`} onClick={onClose}><X size={17} /></button>
      </div>
      {/* `min-h-0` + `overflow-hidden` are load-bearing: this row is a flex item, and
          a flex item defaults to min-height:auto, so a tall pane would grow the row
          past calc(100%-45px). The sidebar is h-full, so the logout footer would ride
          down with it. Pinning the row keeps the footer at a fixed height. */}
      <div className="flex h-[calc(100%-45px)] min-h-0 overflow-hidden">
        {/* min-h-0 lets the tab list scroll rather than expand; shrink-0 keeps the footer put. */}
        <div className="flex h-full w-[148px] flex-none flex-col border-r border-line">
          <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1.5 py-2">
          {tabs.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => patchApp({ setTab: id })}
              className={`flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-[9px] text-left text-xs font-medium ${tab === id ? 'bg-accent-dim text-accent' : 'text-dim hover:bg-panel2 hover:text-ink'}`}
            >
              <Icon size={15} className="flex-none" /><span>{label}</span>
            </button>
          ))}
          </div>
          {/* mockup — no session is actually ended. Pinned in its own flex slot so
              it never moves with the tab list. */}
          <div className="shrink-0 p-1.5">
            <button
              {...useTipProps('ออกจากระบบ')}
              onClick={() => { patchApp({ signedIn: false }); onClose(); toast('ออกจากระบบแล้ว'); }}
              className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-line2 px-2.5 py-2 text-xs font-medium text-dim transition hover:border-[#E5484D] hover:bg-[#E5484D]/10 hover:text-[#FF8B7D]"
            >
              <LogOut size={15} className="flex-none" /><span>ออกจากระบบ</span>
            </button>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-[18px] pb-5 pt-3">
          {tab === 'map' && <MapPane />}
          {tab === 'popup' && <PopupPane onClose={onClose} />}
          {tab === 'search' && <SearchApiPane />}
          {tab === 'look' && <LookPane />}
          {tab === 'draw' && <DrawSettingsPane />}
          {tab === 'server' && <ServerPane />}
          {tab === 'user' && <UserPane />}
          {tab === 'users' && <UserManagePane />}
          {tab === 'about' && <AboutPane />}
        </div>
      </div>
      </div>
    </div>
  );
}

export function Header({ small }: { small: boolean }) {
  const leftOpen = useApp(s => s.leftOpen);
  const rightOpen = useApp(s => s.rightOpen);
  const settingsOpen = useApp(s => s.settingsOpen);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const close = () => patchApp({ settingsOpen: false });
  /* the panel is a child of <header>, so an outside-click check on the header wrapper is enough */
  useOutsideClose([panelRef, btnRef], close, settingsOpen, true);

  return (
    <header className="fs-panel relative z-50 border-b border-line bg-panel [grid-area:hd]">
      <div className="flex h-[var(--header-h)] items-center gap-3 px-3">
      {small && <button className={`${iconBtn} ${leftOpen ? 'text-accent' : ''}`} {...useTipProps('เปิด/ปิดแถบเครื่องมือ')} onClick={() => setLeft(!leftOpen)}><Menu size={17} /></button>}
      <div className={`flex flex-none items-center ${small ? 'gap-[7px]' : 'gap-2.5'}`}>
        <div className="size-[13px] flex-none rotate-45 rounded-[3px] bg-accent" />
        <div>
          <div className={`font-display font-bold leading-none ${small ? 'text-xs tracking-[.08em]' : 'text-sm tracking-[.12em]'}`}>FIELD<span className="text-accent">SCRAPPER</span></div>
          {!small && <div className="mt-0.5 text-[9.5px] text-dim">ข้อมูลที่ดิน และแผนที่</div>}
        </div>
      </div>
      <SearchBox />
      <div className="ml-auto flex flex-none items-center gap-0.5">
        <button className={`${iconBtn} ${leftOpen ? 'text-accent' : ''}`} {...useTipProps('ซ่อน/แสดงแถบเครื่องมือ')} onClick={() => setLeft(!leftOpen)}><PanelLeft size={17} /></button>
        <button className={`${iconBtn} ${rightOpen ? 'text-accent' : ''}`} {...useTipProps('ซ่อน/แสดงแผงรายละเอียด')} onClick={() => setRight(!rightOpen)}><PanelRight size={17} /></button>
        {!small && <div className="mx-1.5 h-5 w-px bg-line2" />}
        <button ref={btnRef} className={`${iconBtn} ${settingsOpen ? 'text-accent' : ''}`} {...useTipProps('ตั้งค่าทั่วไป')} onClick={() => patchApp({ settingsOpen: !settingsOpen })}><Settings2 size={17} /></button>
      </div>
      </div>
      {settingsOpen && <div ref={panelRef} className="contents"><SettingsPanel onClose={close} /></div>}
    </header>
  );
}
