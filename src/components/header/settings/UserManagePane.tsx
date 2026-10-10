import { KeyRound, Plus, RotateCcw, Shield, Trash2, User as UserIcon, X } from 'lucide-react';
import { useState } from 'react';
import { patchApp, toast, useApp } from '../../../store/useApp';
import { btn, btnAcc, frow, fl, inp, setSec } from '../../ui/styles';
import { Switch } from '../../ui/Switch';
import { useTipProps } from '../../ui/Tip';
import { useConfirm } from '../../../hooks/useConfirm';
import type { ManagedUser } from '../../../types';

export type { ManagedUser };

const AVATAR_HUE = ['#4C9AFF', '#2E7D32', '#B18CFF', '#FF9F43', '#E37FD8'];

/**
 * จัดการผู้ใช้ — mockup. Accounts can be added, removed and have their password
 * reset. Nothing is persisted anywhere; a reset only flips local state.
 */
export function UserManagePane() {
  const { confirm, dialog } = useConfirm();
  const me = useApp(s => s.userName);
  const list = useApp(s => s.managedUsers);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'user'>('user');
  const [resetFor, setResetFor] = useState<number | null>(null);
  const [tmpPw, setTmpPw] = useState('');

  const setList = (next: ManagedUser[]) => patchApp({ managedUsers: next });

  const addUser = () => {
    const n = name.trim(), e = email.trim();
    if (!n || !e) { toast('กรอกชื่อและอีเมลให้ครบก่อน'); return; }
    if (list.some(u => u.email.toLowerCase() === e.toLowerCase())) { toast('อีเมลนี้มีอยู่แล้ว'); return; }
    setList([...list, {
      id: Math.max(0, ...list.map(u => u.id)) + 1, name: n, email: e, role,
      active: true, twoFa: false, lastSeen: 'ยังไม่เคยเข้าใช้งาน',
    }]);
    setName(''); setEmail(''); setRole('user'); setAdding(false);
    toast(`เพิ่มผู้ใช้ ${n} แล้ว (จำลอง)`);
  };

  const remove = async (id: number) => {
    const u = list.find(x => x.id === id); if (!u) return;
    /* two hard stops: never delete yourself, and never delete the last account */
    if (u.email === me) { toast('ลบบัญชีของตัวเองไม่ได้'); return; }
    if (list.length <= 1) { toast('ต้องมีผู้ใช้อย่างน้อย 1 บัญชี'); return; }
    const ok = await confirm({
      title: `ลบผู้ใช้ ${u.name}`,
      body: <>บัญชี <b className="text-ink">{u.email}</b> จะถูกลบออกจากรายชื่อทั้งหมด
        การปักหมุดและงานที่ผู้ใช้นี้สร้างไว้จะหายไปด้วย — ย้อนกลับไม่ได้</>,
      confirmText: 'ลบผู้ใช้',
    });
    if (!ok) return;
    setList(list.filter(x => x.id !== id));
    toast(`ลบผู้ใช้ ${u.name} แล้ว (จำลอง)`);
  };

  const resetPw = (id: number) => {
    if (tmpPw.trim().length < 8) { toast('รหัสผ่านชั่วคราวต้องมีอย่างน้อย 8 ตัวอักษร'); return; }
    const u = list.find(x => x.id === id);
    setResetFor(null); setTmpPw('');
    toast(`ส่งรหัสผ่านชั่วคราวให้ ${u?.name ?? ''} แล้ว (จำลอง)`);
  };

  return (
    <>
      {dialog}
      <div className={`${setSec} !mt-0.5`}>ผู้ใช้ทั้งหมด ({list.length})</div>

      {list.map((u, i) => (
        <div key={u.id} className="flex items-center gap-2.5 border-b border-line py-2 last:border-b-0">
          <span
            className="grid size-8 flex-none place-items-center rounded-full text-[11px] font-bold text-white"
            style={{ background: AVATAR_HUE[i % AVATAR_HUE.length] }}
          >
            {u.name.trim().slice(0, 2)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[12px]">{u.name}</span>
              {u.role === 'admin' && (
                <span className="inline-flex flex-none items-center gap-[3px] rounded-full border border-accent/50 bg-accent-dim px-1.5 py-px text-[9.5px] font-medium text-accent">
                  <Shield size={9} />แอดมิน
                </span>
              )}
              {u.email === me && (
                <span className="flex-none rounded-full border border-line2 px-1.5 py-px text-[9.5px] text-dim2">คุณ</span>
              )}
            </div>
            <div className="truncate font-display text-[10.5px] text-dim2">
              {u.email} · {u.lastSeen}
            </div>
          </div>

          <Switch
            checked={u.active}
            {...useTipProps(u.active ? 'ปิดบัญชีนี้' : 'เปิดบัญชีนี้')}
            onChange={v => setList(list.map(x => (x.id === u.id ? { ...x, active: v } : x)))}
          />
          <button
            className="flex-none cursor-pointer rounded p-1 text-dim2 transition hover:bg-panel2 hover:text-accent"
            {...useTipProps(u.twoFa ? 'ปิด 2FA ของผู้ใช้นี้' : 'เปิด 2FA ให้ผู้ใช้นี้')}
            onClick={() => setList(list.map(x => (x.id === u.id ? { ...x, twoFa: !x.twoFa } : x)))}
          >
            <Shield size={13} className={u.twoFa ? 'text-accent' : ''} />
          </button>
          <button
            className="flex-none cursor-pointer rounded p-1 text-dim2 transition hover:bg-panel2 hover:text-accent"
            {...useTipProps('ตั้งรหัสผ่านใหม่ให้ผู้ใช้นี้')}
            onClick={() => { setResetFor(resetFor === u.id ? null : u.id); setTmpPw(''); }}
          >
            <KeyRound size={13} />
          </button>
          {/* disabled rather than hidden, so the rule is discoverable */}
          {(() => {
            const isMe = u.email === me;
            const lastOne = list.length <= 1;
            const locked = isMe || lastOne;
            return (
              <button
                className={`flex-none rounded p-1 transition ${
                  locked ? 'cursor-not-allowed text-line2' : 'cursor-pointer text-dim2 hover:bg-[#E5484D]/10 hover:text-[#FF8B7D]'
                }`}
                {...useTipProps(locked ? (isMe ? 'ลบบัญชีของตัวเองไม่ได้' : 'ต้องมีผู้ใช้อย่างน้อย 1 บัญชี') : 'ลบผู้ใช้นี้')}
                disabled={locked}
                onClick={() => !locked && remove(u.id)}
              >
                <Trash2 size={13} />
              </button>
            );
          })()}

          {resetFor === u.id && (
            <div className="flex w-full items-center gap-2 pb-1 pt-1">
              <input
                className={inp}
                value={tmpPw}
                onChange={e => setTmpPw(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') resetPw(u.id); }}
                placeholder="รหัสผ่านชั่วคราว (อย่างน้อย 8 ตัวอักษร)"
              />
              <button className={`${btn} flex-none`} onClick={() => resetPw(u.id)}>รีเซ็ต</button>
              <button className={`${btn} flex-none`} onClick={() => { setResetFor(null); setTmpPw(''); }}><X size={13} /></button>
            </div>
          )}
        </div>
      ))}

      {adding ? (
        <div className="mt-2 rounded-[10px] border border-line px-3 py-2.5">
          <div className="mb-2 flex items-center gap-1.5 text-[11.5px] font-semibold"><UserIcon size={13} />เพิ่มผู้ใช้ใหม่</div>
          <div className={frow}>
            <span className={fl}>ชื่อ</span>
            <input className={inp} value={name} onChange={e => setName(e.target.value)} placeholder="ชื่อ-นามสกุล" />
          </div>
          <div className={frow}>
            <span className={fl}>อีเมล</span>
            <input className={inp} value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com" />
          </div>
          <div className={frow}>
            <span className={fl}>สิทธิ์</span>
            <div className="flex gap-1.5">
              {(['user', 'admin'] as const).map(r => (
                <button
                  key={r}
                  onClick={() => setRole(r)}
                  className={`cursor-pointer rounded-md border px-2.5 py-1 text-[11px] transition ${
                    role === r ? 'border-accent bg-accent-dim text-accent' : 'border-line2 bg-bg text-dim hover:text-ink'
                  }`}
                >
                  {r === 'admin' ? 'แอดมิน' : 'ผู้ใช้'}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-1.5 flex gap-2">
            <button className={btnAcc} onClick={addUser}><Plus size={13} />เพิ่ม</button>
            <button className={btn} onClick={() => { setAdding(false); setName(''); setEmail(''); }}>ยกเลิก</button>
          </div>
        </div>
      ) : (
        <button className={`${btnAcc} mt-2 w-full justify-center`} onClick={() => setAdding(true)}><Plus size={14} />เพิ่มผู้ใช้</button>
      )}

      <div className="mt-3 flex justify-end">
        <button
          className={btn}
          onClick={() => {
            patchApp({ managedUsers: MOCK_USERS.map(u => ({ ...u })) });
            toast('คืนค่ารายชื่อผู้ใช้เริ่มต้นแล้ว (จำลอง)');
          }}
        >
          <RotateCcw size={13} />คืนค่ารายชื่อเริ่มต้น
        </button>
      </div>
    </>
  );
}

export const MOCK_USERS: ManagedUser[] = [
  { id: 1, name: 'ผู้ดูแลระบบ', email: 'admin@fieldscrapper.app', role: 'admin', active: true, twoFa: true, lastSeen: 'ออนไลน์อยู่' },
  { id: 2, name: 'ณัฐวุฒิ ใจดี', email: 'nut@fieldscrapper.app', role: 'user', active: true, twoFa: false, lastSeen: '2 ชั่วโมงที่แล้ว' },
  { id: 3, name: 'สุชาดี พงษ์ไพบูลย์', email: 'suchat@fieldscrapper.app', role: 'user', active: true, twoFa: true, lastSeen: 'เมื่อวานนี้' },
  { id: 4, name: 'ปิยะ วงศ์ทอง', email: 'piya@fieldscrapper.app', role: 'user', active: false, twoFa: false, lastSeen: '30 วันที่แล้ว' },
];