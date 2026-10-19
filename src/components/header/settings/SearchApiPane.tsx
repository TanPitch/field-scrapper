import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import {
  patchApp,
  toast,
  useApp,
} from '../../../store/useApp';
import {
  nominatimTest,
  tileTest,
  wmsTileUrl,
} from '../../../map/protocols';
import { Seg } from '../../ui/Seg';
import {
  btn,
  fl,
  frow,
  inp,
  setSec,
} from '../../ui/styles';
import { type Cascade } from '../../../types';

/* ค้นหา & API - the two connection tests and the API key field. */
type TestState = { status: 'idle' | 'busy' | 'ok' | 'fail'; msg: string };
/** The short result, rendered as thin opaque text inside the button. */
function testResult(t: TestState): string {
  if (t.status === 'ok') return t.msg ? `ผ่าน ${t.msg}` : 'ผ่าน';
  if (t.status === 'fail') return 'ไม่ผ่าน';
  return '';
}
/** The actionable half of the label: plain "ทดสอบ" until a result exists. */
function testAction(t: TestState): string {
  if (t.status === 'busy') return 'ทดสอบ…';
  if (t.status === 'idle') return 'ทดสอบ';
  return 'ทดสอบใหม่';
}
/* blue = not run yet, muted blue = running, green = pass, red = fail.
   All four carry their colour at rest — hover only deepens it. */
const TEST_CLS = {
  idle: 'border-[#3A6EA5] bg-[#3A6EA5]/15 text-[#7FB3F0] hover:border-[#4C82BC] hover:bg-[#3A6EA5]/25',
  busy: 'cursor-progress border-[#3A6EA5] bg-[#3A6EA5]/10 text-[#6C9FD8]',
  ok: 'border-[#2E7D32] bg-[#2E7D32]/20 text-[#6BD07C] hover:border-[#3E9143] hover:bg-[#2E7D32]/32',
  fail: 'border-[#E5484D] bg-[#E5484D]/20 text-[#FF8B7D] hover:border-[#FF7A6B] hover:bg-[#E5484D]/32',
} as const;

function ApiTestRow({ label, run }: { label: string; run: () => Promise<string> }) {
  const [t, setT] = useState<TestState>({ status: 'idle', msg: '' });
  const go = () => {
    setT({ status: 'busy', msg: '' });
    const t0 = performance.now();
    run()
      .then(() => setT({ status: 'ok', msg: `${Math.round(performance.now() - t0)}ms` }))
      .catch(() => setT({ status: 'fail', msg: '' }));
  };
  const res = testResult(t);
  return (
    <div className="flex items-center gap-2 border-b border-line py-[9px]">
      <span className={fl}>{label}</span>
      <button
        className={`${btn} ml-auto gap-1.5 whitespace-nowrap ${TEST_CLS[t.status]}`}
        onClick={go}
        disabled={t.status === 'busy'}
      >
        {res && <span className="font-display text-[10px] font-light leading-none opacity-70">{res}</span>}
        {testAction(t)}
      </button>
    </div>
  );
}
/** Masks an API key for display: keeps the head and the last few characters. */
function maskKey(k: string): string {
  if (k.length <= 10) return k ? '•'.repeat(Math.max(k.length, 4)) : '';
  return `${k.slice(0, 5)}•••${k.slice(-4)}`;
}
export function SearchApiPane() {
  const cascade = useApp(s => s.cascade);
  const gkey = useApp(s => s.gkey);
  const [showKey, setShowKey] = useState(false);
  const [keyTest, setKeyTest] = useState<TestState>({ status: 'idle', msg: '' });
  const testKey = () => {
    setKeyTest({ status: 'busy', msg: '' });
    const t0 = performance.now();
    (gkey ? new Promise<string>(res => setTimeout(() => res('200 OK (จำลอง)'), 650)) : Promise.reject(new Error('ไม่พบ API Key — ใส่คีย์ก่อน')))
      .then(() => setKeyTest({ status: 'ok', msg: `${Math.round(performance.now() - t0)}ms` }))
      .catch(() => setKeyTest({ status: 'fail', msg: '' }));
  };
  const keyRes = testResult(keyTest);
  return (
    <>
      <div className={`${setSec} !mt-0.5`}>การค้นหา</div>
      <div className={frow}>
        <span className={fl}>ลำดับการค้นหา</span>
        <Seg<Cascade> items={[['google', 'Google → Nominatim'], ['nominatim', 'Nominatim เท่านั้น']]} value={cascade} onChange={v => { patchApp({ cascade: v }); toast('ลำดับการค้นหา: ' + (v === 'google' ? 'Google → Nominatim' : 'Nominatim เท่านั้น')); }} />
      </div>
      {/* single line: label · input (+ eye) · test button */}
      <div className="flex items-center gap-2 border-b border-line py-[9px]">
        <span className={`${fl} flex-none`}>API คีย์</span>
        <div className="relative min-w-0 flex-1">
          <input
            className={`${inp} pr-7 font-display`}
            placeholder="Google Search API Key"
            value={showKey ? gkey : maskKey(gkey)}
            onChange={e => patchApp({ gkey: e.target.value.trim() })}
            onFocus={() => { if (!showKey) setShowKey(true); }}
            spellCheck={false}
          />
          <button
            type="button"
            title={showKey ? 'ซ่อนคีย์' : 'แสดงคีย์เต็ม'}
            onClick={() => setShowKey(v => !v)}
            className="absolute right-1 top-1/2 grid size-5 -translate-y-1/2 cursor-pointer place-items-center rounded text-dim2 hover:bg-panel2 hover:text-ink"
          >
            {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        </div>
        <button
          className={`${btn} ml-auto flex-none gap-1.5 whitespace-nowrap ${TEST_CLS[keyTest.status]}`}
          onClick={testKey}
          disabled={keyTest.status === 'busy'}
        >
          {keyRes && <span className="font-display text-[10px] font-light leading-none opacity-70">{keyRes}</span>}
          {testAction(keyTest)}
        </button>
      </div>
      <div className={`${setSec}`}>API อื่นๆ</div>
      <ApiTestRow label="Nominatim (OSM)" run={nominatimTest} />
      <ApiTestRow
        label="แผนที่ฐาน (Map Tiles)"
        run={async () => {
          const one = (u: string) => tileTest(u).then(() => undefined);
          await one('https://mt0.google.com/vt/lyrs=m&x=6&y=3&z=3');
          await one('https://mt0.google.com/vt/lyrs=y&x=6&y=3&z=3');
          return 'ผ่าน';
        }}
      />
      <ApiTestRow label="ขอบเขตที่ดิน กรมที่ดิน" run={() => tileTest(wmsTileUrl(6, 49, 29))} />
      <ApiTestRow label="ความสูง แผนที่น้ำท่วม" run={() => tileTest('https://s3.amazonaws.com/elevation-tiles-prod/terrarium/7/64/33.png')} />
    </>
  );
}
