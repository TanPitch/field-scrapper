import { Eye, EyeOff, KeyRound, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../../lib/api';
import { patchApp, toast, useApp } from '../../../store/useApp';
import { AvatarPicker, AvatarPreview } from '../../ui/AvatarPicker';
import { Modal } from '../../ui/Modal';
import { btn, btnAcc, frow, fl, inp, setSec } from '../../ui/styles';

/**
 * ผู้ใช้ — the account page. The profile block (display name, picture) writes
 * through to the server account (PUT /api/me), so a name change lands on every
 * device signed in as this user; the picture is a synced pref (avatarCfg) and
 * rides the settings sync instead. Password and 2FA each live in their own
 * popup so the pane itself stays a short, scannable list.
 */
export function UserPane() {
  const username = useApp(s => s.userName);
  const displayName = useApp(s => s.displayName);
  const twoFa = useApp(s => s.twoFa);
  const avatarCfg = useApp(s => s.avatarCfg);

  const [name, setName] = useState(displayName);
  const dirty = name !== displayName;
  const [panel, setPanel] = useState<'pw' | 'twofa' | null>(null);

  /* password form state */
  const [cur, setCur] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);

  const saveProfile = async () => {
    const next = name.trim();
    if (!next) { toast('ใส่ชื่อที่แสดงก่อน', 'warn'); return; }
    const r = await api.put('/api/me', { displayName: next });
    if (!r.ok) { toast(`บันทึกไม่สำเร็จ — ${r.error}`, 'warn'); return; }
    patchApp({ displayName: next });
    toast('บันทึกโปรไฟล์ตามบัญชีแล้ว');
  };

  const closePw = () => { setPanel(null); setCur(''); setPw(''); setPw2(''); };

  const changePw = async () => {
    if (pw.length < 8) { toast('รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร', 'warn'); return; }
    if (pw !== pw2) { toast('รหัสผ่านใหม่ไม่ตรงกัน', 'warn'); return; }
    setSaving(true);
    const r = await api.post('/api/me/password', { currentPassword: cur, newPassword: pw });
    setSaving(false);
    if (!r.ok) {
      toast(r.error === 'current password is wrong' ? 'รหัสผ่านปัจจุบันไม่ถูกต้อง' : `เปลี่ยนไม่สำเร็จ — ${r.error}`, 'warn');
      return;
    }
    closePw();
    toast('เปลี่ยนรหัสผ่านแล้ว');
  };

  return (
    <>
      {/* ---- profile ---- */}
      <div className={`${setSec} !mt-0.5`}>โปรไฟล์</div>
      <div className="flex items-center gap-3 py-1">
        <AvatarPreview cfg={avatarCfg} size={52} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold">{displayName}</div>
          <div className="truncate font-display text-[11px] text-dim2">@{username}</div>
        </div>
        <AvatarPicker cfg={avatarCfg} onChange={next => patchApp({ avatarCfg: next })} />
      </div>

      {/* display name + the update button below it. Disabled until the text
          differs, which is also what keeps an accidental click from PUTting
          the old value back. */}
      <div className="mt-1 rounded-[10px] border border-line px-3 py-2.5">
        <div className={frow}>
          <span className={fl}>ชื่อที่แสดง</span>
          <input className={inp} value={name} onChange={e => setName(e.target.value)} placeholder="เช่น สมชาย ใจดี" />
        </div>
        <div className="mt-1.5 flex justify-end">
          <button className={`${btnAcc} disabled:cursor-not-allowed disabled:opacity-40`} disabled={!dirty} onClick={() => void saveProfile()}>
            อัปเดต
          </button>
        </div>
      </div>

      {/* ---- account & security: two buttons, two popups ---- */}
      <div className={setSec}>ความปลอดภัย</div>
      <div className="flex gap-2 pb-1">
        <button className={`${btn} flex-1 justify-center`} onClick={() => setPanel('pw')}>
          <KeyRound size={13} />เปลี่ยนรหัสผ่าน
        </button>
        <button className={`${btn} flex-1 justify-center`} onClick={() => setPanel('twofa')}>
          <ShieldCheck size={13} />ยืนยันตัวตน 2 ขั้นตอน
        </button>
      </div>
      {twoFa && (
        <div className="mb-1 flex items-start gap-2 rounded-lg border border-line px-3 py-2.5 text-[11.5px] leading-[1.7] text-dim">
          <ShieldCheck size={14} className="mt-[2px] flex-none text-accent" />
          <span>เปิด 2FA อยู่ — ค่านี้เก็บตามบัญชี ทุกเครื่องที่ล็อกอินด้วยบัญชีนี้เห็นผลเดียวกัน</span>
        </div>
      )}

      {panel === 'pw' && (
        <Modal title="เปลี่ยนรหัสผ่าน" onClose={closePw}>
          <div className="mt-3 space-y-2">
            <div className={frow}>
              <span className={fl}>รหัสผ่านปัจจุบัน</span>
              <input className={inp} type={show ? 'text' : 'password'} value={cur} onChange={e => setCur(e.target.value)} placeholder="รหัสที่ใช้อยู่" />
            </div>
            <div className={frow}>
              <span className={fl}>รหัสผ่านใหม่</span>
              <input className={inp} type={show ? 'text' : 'password'} value={pw} onChange={e => setPw(e.target.value)} placeholder="อย่างน้อย 8 ตัวอักษร" />
            </div>
            <div className={frow}>
              <span className={fl}>ยืนยันรหัสใหม่</span>
              <input className={inp} type={show ? 'text' : 'password'} value={pw2} onChange={e => setPw2(e.target.value)}
                placeholder="พิมพ์ซ้ำอีกครั้ง" onKeyDown={e => { if (e.key === 'Enter') void changePw(); }} />
            </div>
          </div>
          <div className="mt-2.5 flex items-center gap-2">
            <button className={btn} onClick={() => setShow(v => !v)}>{show ? <EyeOff size={13} /> : <Eye size={13} />}{show ? 'ซ่อน' : 'แสดง'}</button>
            <button className={`${btnAcc} ml-auto`} disabled={saving} onClick={() => void changePw()}>
              <KeyRound size={13} />บันทึกรหัสใหม่
            </button>
          </div>
        </Modal>
      )}

      {panel === 'twofa' && (
        <Modal title="ยืนยันตัวตน 2 ขั้นตอน" onClose={() => setPanel(null)}>
          <div className="mt-2 text-[11.5px] leading-[1.75] text-dim">
            {twoFa
              ? 'เปิดใช้อยู่ — การเข้าสู่ระบบจากเครื่องใหม่จะต้องยืนยันตัวตนเพิ่มอีกหนึ่งขั้น'
              : 'ปิดอยู่ — เปิดเพื่อให้การเข้าสู่ระบบต้องยืนยันตัวตนอีกหนึ่งขั้น ค่านี้เก็บตามบัญชีผู้ใช้'}
          </div>
          <div className="mt-4 flex justify-end">
            <button className={btnAcc} onClick={() => { patchApp({ twoFa: !twoFa }); toast(twoFa ? 'ปิด 2FA แล้ว' : 'เปิด 2FA แล้ว'); }}>
              {twoFa ? 'ปิด 2FA' : 'เปิด 2FA'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
