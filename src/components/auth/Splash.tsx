import { Eye, EyeOff, Lock, Mail, User } from 'lucide-react';
import { useRef, useState } from 'react';
import { patchApp, toast } from '../../store/useApp';
import { useTipProps } from '../ui/Tip';

type Stage = 'login' | 'register' | 'otp' | 'forgot';

const ACCOUNTS = [
  { id: 'admin', name: 'admin', pw: 'admin1234', role: 'admin' as const },
  { id: 'user', name: 'fieldscrapper', pw: 'user1234', role: 'user' as const },
];

/**
 * Splash / sign-in. A self-contained mockup: credentials are checked against a
 * hard-coded list and the 2FA code only has to be six digits. There is no real
 * session, no server, and no way to register an account from here.
 */
export function Splash() {
  const [stage, setStage] = useState<Stage>('login');
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);
  const [otp, setOtp] = useState<string[]>(() => Array(6).fill(''));
  /* a plain ref array, not state: React 19 treats a ref callback's return value as
     a cleanup function, so a callback returning new state would detach and re-attach
     on every render -> setState -> render, forever. */
  const otpRefs = useRef<Array<HTMLInputElement | null>>([]);
  const [err, setErr] = useState('');

  const signIn = () => {
    const acct = ACCOUNTS.find(a => a.id === id.trim().toLowerCase() || a.id === id.trim());
    if (!acct) { setErr('ไม่พบบัญชีนี้'); return; }
    if (pw !== acct.pw) { setErr('รหัสผ่านไม่ถูกต้อง'); return; }
    setErr('');
    /* the admin account is the one that already has 2FA switched on */
    if (acct.role === 'admin') { setStage('otp'); return; }
    patchApp({ signedIn: true, role: acct.role, userName: acct.name });
  };

  const verifyOtp = () => {
    if (otp.some(c => !c)) { setErr('กรอกรหัส OTP ให้ครบ 6 หลัก'); return; }
    setErr('');
    patchApp({ signedIn: true, role: 'admin', userName: 'admin' });
  };

  /* commit one digit into box i, then jump to the next empty one */
  const commitDigit = (i: number, d: string) => {
    setOtp(prev => {
      const next = [...prev];
      next[i] = d;
      return next;
    });
    const nextEmpty = otp.findIndex((c, j) => j > i && !c);
    if (nextEmpty !== -1) otpRefs.current[nextEmpty]?.focus();
    else if (i < 5) otpRefs.current[i + 1]?.focus();
    setErr('');
  };

  /* type a digit -> jump to the next empty box; Backspace on an empty box -> step back */
  const onOtpKey = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    const k = e.key;
    if (k === 'Backspace') {
      e.preventDefault();
      setOtp(prev => {
        const next = [...prev];
        if (next[i]) next[i] = '';
        else if (i > 0) { next[i - 1] = ''; otpRefs.current[i - 1]?.focus(); }
        return next;
      });
      return;
    }
    if (k === 'ArrowLeft' && i > 0) { e.preventDefault(); otpRefs.current[i - 1]?.focus(); return; }
    if (k === 'ArrowRight' && i < 5) { e.preventDefault(); otpRefs.current[i + 1]?.focus(); return; }
    if (!/^\d$/.test(k)) return;
    e.preventDefault();
    commitDigit(i, k);
  };

  const onOtpPaste = (e: React.ClipboardEvent) => {
    const digits = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!digits) return;
    e.preventDefault();
    setOtp(Array.from({ length: 6 }, (_, i) => digits[i] ?? ''));
    otpRefs.current[Math.min(digits.length, 5)]?.focus();
  };

  const inputCls = 'w-full rounded-[9px] border border-line2 bg-bg px-3 py-2.5 text-[12.5px] text-ink outline-none focus:border-accent';

  return (
    <div className="fixed inset-0 z-[200] grid bg-bg lg:grid-cols-[1fr_minmax(360px,42%)]">
      {/* left: brand panel — hidden on small screens */}
      <section className="relative hidden overflow-hidden lg:block">
        <img
          src={`${import.meta.env.BASE_URL}splash-hero.jpg`}
          alt="แผนที่และแว่นตาบนโต๊ะทำงาน"
          className="absolute inset-0 size-full object-cover opacity-[0.35] blur-sm"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-bg/85 via-bg/55 to-bg/95" />
        <div className="relative flex h-full flex-col justify-between p-10">
          <div className="flex items-center gap-2.5">
            <div className="size-4 rotate-45 rounded-[4px] bg-accent" />
            <span className="font-display text-base font-bold tracking-[.12em]">FIELD<span className="text-accent">SCRAPPER</span></span>
          </div>
          <div className="max-w-[420px]">
            <h1 className="font-display text-[30px] font-bold leading-tight">ข้อมูลประมูลที่ดิน<br />และแผนที่ ครบในที่เดียว</h1>
            <p className="mt-3 text-[13px] leading-[1.85] text-dim">
              รวมแปลงที่ดินจากกรมบังคับคดีและกรมที่ดิน พร้อมชั้นเซ็นเซอร์น้ำ กล้อง CCTV
              และรถประจำทาง พร้อมค้นหาออนไลน์และวิเคราะห์ราคาประมูลย้อนหลัง
            </p>
            <div className="mt-6 flex flex-wrap gap-2 text-[11px] text-dim2">
              {['แปลงที่ดิน 12,000+', 'ประมูลราคาประเมิน', 'เซ็นเซอร์น้ำ', 'กล้อง CCTV', 'สายรถประจำทาง'].map(t => (
                <span key={t} className="bg-panel rounded-md border border-line2 px-2.5 py-1">{t}</span>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-dim2">
            <span className="font-display">v2.2.0 · เวอร์ชันภายใน</span>
            {/* Unsplash attribution is required by their licence — keep it visible. */}
            <span>
              Photo by{' '}
              <a
                href="https://unsplash.com/@arttravelling?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText"
                target="_blank"
                rel="noreferrer noopener"
                className="text-dim underline decoration-line2 underline-offset-2 transition hover:text-ink"
              >
                oxana v
              </a>
              {' on '}
              <a
                href="https://unsplash.com/photos/eyeglasses-on-map-qoAIlAmLJBU?utm_source=unsplash&utm_medium=referral&utm_content=creditCopyText"
                target="_blank"
                rel="noreferrer noopener"
                className="text-dim underline decoration-line2 underline-offset-2 transition hover:text-ink"
              >
                Unsplash
              </a>
            </span>
          </div>
        </div>
      </section>

      {/* right: auth form */}
      <section className="flex items-center justify-center overflow-y-auto border-line bg-panel px-5 py-8 lg:border-l">
        <div className="w-full max-w-[340px]">
          <div className="mb-6 flex items-center gap-2.5 lg:hidden">
            <div className="size-4 rotate-45 rounded-[4px] bg-accent" />
            <span className="font-display text-sm font-bold tracking-[.12em]">FIELD<span className="text-accent">SCRAPPER</span></span>
          </div>

          {stage === 'login' && (
            <>
              <h2 className="font-display text-[19px] font-semibold">เข้าสู่ระบบ</h2>
              <p className="mt-1 text-[11.5px] text-dim">กรอกบัญชีเพื่อเข้าใช้งานแผนที่</p>

              <div className="mt-5 space-y-2.5">
                <div className="relative">
                  <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-dim2" />
                  <input
                    className={`${inputCls} pl-9`}
                    value={id}
                    onChange={e => { setId(e.target.value); setErr(''); }}
                    placeholder="ชื่อผู้ใช้"
                    autoComplete="username"
                  />
                </div>
                <div className="relative">
                  <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-dim2" />
                  <input
                    className={`${inputCls} px-9`}
                    type={showPw ? 'text' : 'password'}
                    value={pw}
                    onChange={e => { setPw(e.target.value); setErr(''); }}
                    onKeyDown={e => { if (e.key === 'Enter') signIn(); }}
                    placeholder="รหัสผ่าน"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    {...useTipProps(showPw ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน')}
                    onClick={() => setShowPw(v => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer text-dim2 transition hover:text-ink"
                  >
                    {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              <label className="mt-3 flex cursor-pointer items-center gap-2 text-[11.5px] text-dim">
                <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} className="accent-[var(--accent)]" />
                จดจำฉันไว้บนเครื่องนี้
              </label>

              {err && <div className="mt-3 rounded-lg bg-[#E5484D]/12 px-3 py-2 text-[11.5px] text-[#FF8B7D]">{err}</div>}

              <button onClick={signIn} className="mt-4 w-full cursor-pointer rounded-[9px] bg-accent py-2.5 text-[12.5px] font-semibold text-accent-ink transition hover:bg-[#C9FA57]">
                เข้าสู่ระบบ
              </button>

              <div className="mt-3 flex items-center justify-between text-[11px]">
                <button className="cursor-pointer text-dim transition hover:text-ink" onClick={() => { setStage('register'); setErr(''); }}>
                  ลงทะเบียน
                </button>
                <button className="cursor-pointer text-dim transition hover:text-ink" onClick={() => { setStage('forgot'); setErr(''); }}>
                  ลืมรหัสผ่าน?
                </button>
              </div>

              <div className="mt-6 rounded-lg border border-line px-3 py-2.5 text-[10.5px] leading-[1.7] text-dim2">
                บัญชีสำหรับทดสอบ — <b className="font-display text-dim">admin / admin1234</b> (มี 2FA)
                · <b className="font-display text-dim">fieldscrapper / user1234</b>
              </div>
            </>
          )}

          {stage === 'otp' && (
            <>
              <button className="cursor-pointer text-[11.5px] text-dim transition hover:text-ink" onClick={() => { setStage('login'); setErr(''); }}>← กลับ</button>
              <h2 className="mt-3 font-display text-[19px] font-semibold">ยืนยันตัวตน 2 ขั้นตอน</h2>
              <p className="mt-1 text-[11.5px] text-dim">กรอกรหัส 6 หลักจากแอป Authenticator</p>
              <div className="mt-5 flex justify-between gap-1.5">
                {otp.map((d, i) => (
                  <input
                    key={i}
                    ref={el => { otpRefs.current[i] = el; }}
                    value={d}
                    onChange={e => {
                      /* safety net for mobile keyboards / IME, which may not fire keydown */
                      const v = e.target.value.replace(/\D/g, '').slice(-1);
                      if (v && v !== otp[i]) commitDigit(i, v);
                    }}
                    onKeyDown={e => onOtpKey(i, e)}
                    onPaste={onOtpPaste}
                    inputMode="numeric"
                    autoComplete={i === 0 ? 'one-time-code' : 'off'}
                    maxLength={1}
                    className="h-[46px] w-full min-w-0 rounded-[9px] border border-line2 bg-bg text-center font-display text-[18px] text-ink outline-none transition focus:border-accent"
                    aria-label={`หลักที่ ${i + 1}`}
                  />
                ))}
              </div>
              {err && <div className="mt-3 rounded-lg bg-[#E5484D]/12 px-3 py-2 text-[11.5px] text-[#FF8B7D]">{err}</div>}
              <button onClick={verifyOtp} className="mt-4 w-full cursor-pointer rounded-[9px] bg-accent py-2.5 text-[12.5px] font-semibold text-accent-ink transition hover:bg-[#C9FA57]">
                ยืนยัน
              </button>
              <p className="mt-3 text-[10.5px] text-dim2">ทดสอบ: กรอกเลข 6 หลักใดก็ได้ — พิมพ์ต่อจะเลื่อนช่องให้อัตโนมัติ</p>
            </>
          )}

          {stage === 'forgot' && (
            <>
              <button className="cursor-pointer text-[11.5px] text-dim transition hover:text-ink" onClick={() => { setStage('login'); setErr(''); }}>← กลับ</button>
              <h2 className="mt-3 font-display text-[19px] font-semibold">ลืมรหัสผ่าน</h2>
              <p className="mt-1 text-[11.5px] leading-[1.7] text-dim">
                ระบบนี้ไม่มีการกู้รหัสผ่านด้วยตัวเอง เพื่อความปลอดภัย การตั้งรหัสผ่านใหม่ต้องให้
                <b className="text-ink">ผู้ดูแลระบบ (admin)</b> ทำให้เท่านั้น
              </p>
              <div className="mt-4 rounded-[10px] border border-line2 bg-panel2 px-3.5 py-3 text-[11.5px] leading-[1.85] text-dim">
                <b className="text-ink">วิธีขอรีเซ็ตรหัสผ่าน</b>
                <ol className="mt-1.5 list-none space-y-1">
                  <li>1. ติดต่อผู้ดูแลระบบผ่านช่องทางภายในองค์กร</li>
                  <li>2. แจ้งชื่อผู้ใช้หรืออีเมลที่ลงทะเบียนไว้</li>
                  <li>3. ผู้ดูแลจะเข้าเมนู <b className="text-ink">ตั้งค่าทั่วไป → จัดการผู้ใช้</b></li>
                  <li>4. กดไอคอนกุญแจเพื่อออกรหัสผ่านชั่วคราว แล้วส่งให้เจ้าของบัญชี</li>
                </ol>
              </div>
              <button
                onClick={() => toast('ส่งคำขอการกู้รหัสผ่านแล้ว — ผู้ดูแลระบบจะติดต่อกลับ (จำลอง)')}
                className="mt-4 w-full cursor-pointer rounded-[9px] bg-accent py-2.5 text-[12.5px] font-semibold text-accent-ink transition hover:bg-[#C9FA57]"
              >
                ขอให้ผู้ดูแลระบบรีเซ็ต
              </button>
              <button className="mt-2 w-full cursor-pointer text-[11.5px] text-dim transition hover:text-ink" onClick={() => setStage('login')}>
                กลับไปเข้าสู่ระบบ
              </button>
            </>
          )}

          {stage === 'register' && (
            <>
              <h2 className="font-display text-[19px] font-semibold">ขอสิทธิ์เข้าใช้งาน</h2>
              <p className="mt-1 text-[11.5px] text-dim">การสมัครต้องได้รับอนุมัติจากผู้ดูแลระบบ</p>
              <div className="mt-4 space-y-2.5">
                <div className="relative">
                  <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-dim2" />
                  <input className={`${inputCls} pl-9`} placeholder="ชื่อ-นามสกุลที่ต้องการใช้" />
                </div>
                <div className="relative">
                  <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-dim2" />
                  <input className={`${inputCls} pl-9`} placeholder="อีเมลสำหรับติดต่อกลับ" />
                </div>
              </div>
              {/* <div className="mt-3 rounded-lg border border-line2 bg-panel2 px-3 py-2.5 text-[11px] leading-[1.7] text-dim">
                ระบบนี้**ไม่เปิดให้สมัครเอง** — แม้ผู้ดูแลระบบจะเพิ่มผู้ใช้ในเมนู
                <b className="text-ink">จัดการผู้ใช้</b> ที่นั่นก็จะไม่สร้างบัญชีให้เข้าสู่ระบบได้จริง
                การอนุมัติจริงต้องทำผ่านระบบภายนอก
              </div> */}
              <button
                onClick={() => { toast('ส่งคำขอแล้ว — รอผู้ดูแลระบบอนุมัติ (จำลอง)'); setStage('login'); }}
                className="mt-4 w-full cursor-pointer rounded-[9px] border border-line2 py-2.5 text-[12.5px] font-medium text-dim transition hover:border-accent hover:text-accent"
              >
                ส่งคำขอสิทธิ์
              </button>
              <button className="mt-2 w-full cursor-pointer text-[11.5px] text-dim transition hover:text-ink" onClick={() => setStage('login')}>
                กลับไปเข้าสู่ระบบ
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}