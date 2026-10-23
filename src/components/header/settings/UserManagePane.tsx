import { KeyRound, Plus, RefreshCw, Shield, Trash2, UserPlus, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { toast, useApp } from '../../../store/useApp';
import { useConfirm } from '../../../hooks/useConfirm';
import { AvatarPreview, type AvatarCfg } from '../../ui/AvatarPicker';
import { Modal } from '../../ui/Modal';
import { btn, btnAcc, frow, fl, inp, setSec } from '../../ui/styles';
import { Switch } from '../../ui/Switch';
import { useTipProps } from '../../ui/Tip';
import type { ManagedUser } from '../../../types';

const seen = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('th-TH', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : 'ยังไม่เคยเข้าใช้';

const errTh = (e: string) =>
  e === 'username taken' ? 'ชื่อผู้ใช้นี้ถูกใช้แล้ว'
  : e.includes('username') ? 'รูปแบบชื่อผู้ใช้ไม่ถูกต้อง (a-z 0-9 . _ - 3–32 ตัวอักษร)'
  : e.includes('password') ? 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร'
  : `ทำรายการไม่สำเร็จ — ${e}`;

/**
 * จัดการผู้ใช้ — the admin's account manager, backed by /api/users.
 *
 * Everything here is one round-trip per action and then a re-read of the list;
 * the list is small, and re-reading after every mutation means the screen can
 * never claim something the server did not confirm. The guards the UI shows
 * (no deleting yourself, no empty admin seat) are also enforced by the server
 * — the disabled buttons explain the rule, the server makes it true.
 */
export function UserManagePane() {
  const me = useApp(s => s.userName);
  const { confirm, dialog } = useConfirm();

  const [list, setList] = useState<ManagedUser[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [resetFor, setResetFor] = useState<ManagedUser | null>(null);
  const [tmpPw, setTmpPw] = useState('');

  /* add-user form */
  const [urname, setUrname] = useState('');
  const [rname, setRname] = useState('');
  const [rpw, setRpw] = useState('');
  const [radmin, setRadmin] = useState(false);

  const load = useCallback(async () => {
    const r = await api.get<{ users: ManagedUser[] }>('/api/users');
    if (r.ok && r.data) { setList(r.data.users); setErr(null); }
    else setErr(r.error);
  }, []);

  useEffect(() => { void load(); }, [load]);

  /** Run one mutation, translate failures, and refresh the list either way —
   *  a confirmed mutation followed by a failed refresh must not read as
   *  "nothing happened". */
  const mutate = async (run: () => Promise<{ ok: boolean; error: string | null }>, done: string) => {
    const r = await run();
    if (!r.ok) { toast(errTh(r.error ?? 'unknown error'), 'warn'); await load(); return; }
    toast(done);
    await load();
  };

  const addUser = async () => {
    if (!urname.trim() || rpw.length < 8) {
      toast('กรอกชื่อผู้ใช้ + รหัสผ่านอย่างน้อย 8 ตัวอักษร', 'warn');
      return;
    }
    await mutate(
      () => api.post('/api/users', {
        username: urname.trim().toLowerCase(),
        password: rpw,
        displayName: rname.trim() || urname.trim(),
        isAdmin: radmin,
      }),
      `เพิ่มผู้ใช้ ${rname.trim() || urname.trim()} แล้ว`,
    );
    setUrname(''); setRname(''); setRpw(''); setRadmin(false); setAdding(false);
  };

  const resetPw = async () => {
    const u = resetFor;
    if (!u || tmpPw.length < 8) { toast('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร', 'warn'); return; }
    setResetFor(null); setTmpPw('');
    await mutate(() => api.post(`/api/users/${u.id}/password`, { password: tmpPw }), `ตั้งรหัสผ่านใหม่ให้ ${u.displayName} แล้ว`);
  };

  const remove = async (u: ManagedUser) => {
    const ok = await confirm({
      title: `ลบผู้ใช้ ${u.displayName}`,
      body: <>บัญชี <b className="text-ink">@{u.username}</b> และค่าที่ตั้งไว้ทั้งหมด (รูปหน้าชื่อ การตั้งค่า ตาราง ปักหมุด)
        จะถูกลบถาวร รวมถึงเซสชันที่ยังล็อกอินอยู่ — ย้อนกลับไม่ได้</>,
      confirmText: 'ลบผู้ใช้',
      requireText: u.username,
    });
    if (!ok) return;
    await mutate(() => api.del(`/api/users/${u.id}`), `ลบผู้ใช้ ${u.displayName} แล้ว`);
  };

  return (
    <>
      {dialog}

      <div className="flex items-center gap-2">
        <div className={`${setSec} flex-1 !mt-0.5`}>ผู้ใช้ทั้งหมด ({list?.length ?? '…'})</div>
        <button
          className="mb-1 flex-none cursor-pointer rounded p-1 text-dim2 transition hover:bg-panel2 hover:text-accent"
          {...useTipProps('โหลดรายชื่อใหม่')}
          onClick={() => void load()}
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {err && (
        <div className="rounded-lg border border-[#E5484D]/40 bg-[#E5484D]/[.07] px-3 py-2 text-[11px] leading-[1.6] text-[#FF8B7D]">
          {errTh(err)}
        </div>
      )}

      {list?.map(u => {
        const isMe = u.username === me;
        return (
          <div key={u.id} className="flex items-center gap-2.5 border-b border-line py-2 last:border-b-0">
            {/* the user's own picture choice — an uploaded image when they set
                one, their icon/colour otherwise, never an arbitrary hue. */}
            <AvatarPreview
              cfg={(u.avatarCfg ?? { icon: 'user', from: u.avatarColor || '#4C9AFF', to: '', image: '' }) as AvatarCfg}
              size={34}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className={`truncate text-[12px] ${u.disabled ? 'text-dim2 line-through' : ''}`}>{u.displayName}</span>
                {u.isAdmin && (
                  <span className="inline-flex flex-none items-center gap-[3px] rounded-full border border-accent/50 bg-accent-dim px-1.5 py-px text-[9.5px] font-medium text-accent">
                    <Shield size={9} />แอดมิน
                  </span>
                )}
                {isMe && (
                  <span className="flex-none rounded-full border border-line2 px-1.5 py-px text-[9.5px] text-dim2">คุณ</span>
                )}
              </div>
              <div className="truncate font-display text-[10.5px] text-dim2">
                @{u.username} · ล่าสุด {seen(u.lastSeen)}
              </div>
            </div>

            {/* suspend/resume — disabled for your own account, or the server
                would happily let you lock yourself out mid-session. */}
            <Switch
              checked={!u.disabled}
              {...useTipProps(isMe ? 'ปิดบัญชีของตัวเองไม่ได้' : u.disabled ? 'เปิดใช้บัญชีนี้อีกครั้ง' : 'ระงับบัญชีนี้ (ล็อกอินไม่ได้)')}
              disabled={isMe}
              onChange={v => void mutate(
                () => api.patch(`/api/users/${u.id}`, { disabled: !v }),
                v ? `เปิดใช้บัญชี ${u.displayName} แล้ว` : `ระงับบัญชี ${u.displayName} แล้ว`,
              )}
            />
            {/* admin badge toggler */}
            <button
              className="flex-none cursor-pointer rounded p-1 text-dim2 transition hover:bg-panel2 hover:text-accent"
              {...useTipProps(u.isAdmin ? 'ถอนสิทธิ์แอดมิน' : 'ให้สิทธิ์แอดมิน')}
              onClick={() => void mutate(
                () => api.patch(`/api/users/${u.id}`, { isAdmin: !u.isAdmin }),
                u.isAdmin ? `ถอนสิทธิ์แอดมินของ ${u.displayName} แล้ว` : `ให้ ${u.displayName} เป็นแอดมินแล้ว`,
              )}
            >
              <Shield size={13} className={u.isAdmin ? 'text-accent' : ''} />
            </button>
            <button
              className="flex-none cursor-pointer rounded p-1 text-dim2 transition hover:bg-panel2 hover:text-accent"
              {...useTipProps('ตั้งรหัสผ่านใหม่ให้ผู้ใช้นี้')}
              onClick={() => { setResetFor(u); setTmpPw(''); }}
            >
              <KeyRound size={13} />
            </button>
            <button
              className={`flex-none rounded p-1 transition ${
                isMe ? 'cursor-not-allowed text-line2' : 'cursor-pointer text-dim2 hover:bg-[#E5484D]/10 hover:text-[#FF8B7D]'
              }`}
              {...useTipProps(isMe ? 'ลบบัญชีของตัวเองไม่ได้' : 'ลบผู้ใช้นี้')}
              disabled={isMe}
              onClick={() => !isMe && void remove(u)}
            >
              <Trash2 size={13} />
            </button>
          </div>
        );
      })}

      {adding ? (
        <div className="mt-2 rounded-[10px] border border-line px-3 py-2.5">
          <div className="mb-2 flex items-center gap-1.5 text-[11.5px] font-semibold"><UserPlus size={13} />เพิ่มผู้ใช้ใหม่</div>
          <div className={frow}>
            <span className={fl}>ชื่อผู้ใช้</span>
            <input className={inp} value={urname} onChange={e => setUrname(e.target.value)} placeholder="@username (a-z 0-9 . _ -)" />
          </div>
          <div className={frow}>
            <span className={fl}>ชื่อที่แสดง</span>
            <input className={inp} value={rname} onChange={e => setRname(e.target.value)} placeholder="ชื่อ-นามสกุล (ถ้าว่าง ใช้ชื่อผู้ใช้)" />
          </div>
          <div className={frow}>
            <span className={fl}>รหัสผ่านเริ่มต้น</span>
            <input className={inp} value={rpw} onChange={e => setRpw(e.target.value)} placeholder="อย่างน้อย 8 ตัวอักษร" />
          </div>
          <div className={frow}>
            <span className={fl}>สิทธิ์</span>
            <div className="flex gap-1.5">
              {([false, true] as const).map(r => (
                <button
                  key={String(r)}
                  type="button"
                  onClick={() => setRadmin(r)}
                  className={`cursor-pointer rounded-md border px-2.5 py-1 text-[11px] transition ${
                    radmin === r ? 'border-accent bg-accent-dim text-accent' : 'border-line2 bg-bg text-dim hover:text-ink'
                  }`}
                >
                  {r ? 'แอดมิน' : 'ผู้ใช้'}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-1.5 flex gap-2">
            <button className={btnAcc} onClick={() => void addUser()}><Plus size={13} />เพิ่ม</button>
            <button className={btn} onClick={() => { setAdding(false); setUrname(''); setRname(''); setRpw(''); }}>ยกเลิก</button>
          </div>
        </div>
      ) : (
        <button className={`${btnAcc} mt-2 w-full justify-center`} onClick={() => setAdding(true)}><Plus size={14} />เพิ่มผู้ใช้</button>
      )}

      {resetFor && (
        <Modal title={`ตั้งรหัสผ่านใหม่ให้ ${resetFor.displayName}`} onClose={() => { setResetFor(null); setTmpPw(''); }}>
          <div className="mt-1 text-[11.5px] leading-[1.7] text-dim">
            ตั้งรหัสผ่านใหม่ให้บัญชี <b className="text-ink">@{resetFor.username}</b> — ผู้ใช้ควรเปลี่ยนอีกครั้งหลังเข้าสู่ระบบ
          </div>
          <div className="mt-3 flex items-center gap-2">
            <input
              autoFocus
              className={inp}
              value={tmpPw}
              onChange={e => setTmpPw(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void resetPw(); }}
              placeholder="รหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)"
            />
            <button className={`${btn} flex-none`} onClick={() => { setResetFor(null); setTmpPw(''); }}><X size={13} /></button>
          </div>
          <div className="mt-3 flex justify-end">
            <button className={btnAcc} onClick={() => void resetPw()}><KeyRound size={13} />บันทึกรหัสผ่าน</button>
          </div>
        </Modal>
      )}
    </>
  );
}
