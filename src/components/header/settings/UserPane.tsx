import { AlertTriangle, Eye, EyeOff, KeyRound, ShieldCheck } from 'lucide-react';
import { AvatarPicker, AvatarPreview } from '../../ui/AvatarPicker';
import { useConfirm } from '../../../hooks/useConfirm';
import { useState } from 'react';
import { patchApp, toast, useApp } from '../../../store/useApp';
import { btn, btnAcc, frow, fl, inp, setSec } from '../../ui/styles';
import { Switch } from '../../ui/Switch';

/**
 * ผู้ใช้ — mockup of an account page. Nothing here talks to a backend; it only
 * proves out the layout and the affordances (avatar, locked username, password
 * fields, 2FA, danger zone).
 */
export function UserPane() {
  const username = useApp(s => s.userName);
  const displayName = useApp(s => s.displayName);
  const twoFa = useApp(s => s.twoFa);
  const avatarCfg = useApp(s => s.avatarCfg);
  const { confirm, dialog } = useConfirm();

  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [show, setShow] = useState(false);

  const changePw = () => {
    if (pw.length < 8) { toast('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร'); return; }
    if (pw !== pw2) { toast('รหัสผ่านใหม่ไม่ตรงกัน'); return; }
    setPw(''); setPw2('');
    toast('เปลี่ยนรหัสผ่านแล้ว (จำลอง)');
  };

  const deleteSelf = async () => {
    const ok = await confirm({
      title: 'ลบบัญชีของคุณเอง',
      body: <>บัญชี <b className="text-ink">@{username}</b> และข้อมูลทั้งหมดจะถูกลบถาวร
        รวมถึงประวัติการค้นหา งานที่ตั้งไว้ และการปักหมุด — ย้อนกลับไม่ได้</>,
      confirmText: 'ลบบัญชีถาวร',
      requireText: username,
    });
    if (!ok) return;
    patchApp({ signedIn: false });
    toast('ลบบัญชีแล้ว (จำลอง) — กลับไปหน้าเข้าสู่ระบบ');
  };

  return (
    <>
      {dialog}
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

      <div className={frow}>
        <span className={fl}>ชื่อผู้ใช้</span>
        <input className={`${inp} pointer-events-none opacity-60`} value={username} readOnly />
      </div>
      <div className={frow}>
        <span className={fl}>ชื่อที่แสดง</span>
        <input className={inp} value={displayName} onChange={e => patchApp({ displayName: e.target.value })} placeholder="เช่น สมชาย ใจดี" />
      </div>

      {/* ---- password ---- */}
      <div className={setSec}>เปลี่ยนรหัสผ่าน</div>
      <div className={frow}>
        <span className={fl}>รหัสผ่านใหม่</span>
        <input className={inp} type={show ? 'text' : 'password'} value={pw} onChange={e => setPw(e.target.value)} placeholder="อย่างน้อย 8 ตัวอักษร" />
      </div>
      <div className={frow}>
        <span className={fl}>ยืนยันรหัสผ่าน</span>
        <input className={inp} type={show ? 'text' : 'password'} value={pw2} onChange={e => setPw2(e.target.value)} placeholder="พิมพ์ซ้ำอีกครั้ง" />
      </div>
      <div className="flex items-center gap-2 pb-1">
        <button className={btn} onClick={() => setShow(v => !v)}>{show ? <EyeOff size={13} /> : <Eye size={13} />}{show ? 'ซ่อน' : 'แสดง'}</button>
        <button className={btnAcc} onClick={changePw}><KeyRound size={13} />บันทึกรหัสผ่าน</button>
      </div>

      {/* ---- security ---- */}
      <div className={setSec}>ความปลอดภัย</div>
      <div className={frow}>
        <span className={fl}>
          <span className="inline-flex items-center gap-[6px]">ยืนยันตัวตน 2 ขั้นตอน (2FA)</span>
        </span>
        <Switch checked={twoFa} onChange={v => { patchApp({ twoFa: v }); toast(v ? 'เปิด 2FA แล้ว (จำลอง)' : 'ปิด 2FA แล้ว'); }} />
      </div>
      {twoFa && (
        <div className="flex items-start gap-2 rounded-lg border border-line px-3 py-2.5 text-[11.5px] leading-[1.7] text-dim">
          <ShieldCheck size={14} className="mt-[2px] flex-none text-accent" />
          <span>
            เปิด 2FA แล้ว — รหัส OTP จะถูกส่งไปยังแอป Authenticator
            กู้คืนด้วยรหัสสำรอง: <b className="font-display text-ink">••••-4821</b>
          </span>
        </div>
      )}

      {/* ---- danger zone ---- */}
      <div className="mt-4 rounded-[10px] border border-[#E5484D]/50 bg-[#E5484D]/[.07] px-3 py-2.5">
        <div className="flex items-center gap-[7px] text-[11.5px] font-semibold text-[#FF8B7D]">
          <AlertTriangle size={14} />โซนอันตราย
        </div>
        <p className="mt-1 text-[11px] leading-[1.65] text-dim">
          การลบบัญชีจะลบข้อมูลทั้งหมดถาวร รวมถึงประวัติการค้นหาและงานที่ตั้งไว้ และย้อนกลับไม่ได้
        </p>
        <div className="mt-2">
          <button className={`${btn} w-full justify-center !border-[#E5484D]/50 text-[#FF8B7D] hover:!bg-[#E5484D]/10`} onClick={deleteSelf}>
            ลบบัญชีของฉัน
          </button>
        </div>
      </div>
    </>
  );
}
