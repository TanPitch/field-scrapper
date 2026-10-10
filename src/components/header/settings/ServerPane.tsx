import { CheckCircle2, CircleDashed, Loader2, Server } from 'lucide-react';
import { frow, fl, setSec } from '../../ui/styles';

export type TaskState = 'queued' | 'running' | 'done' | 'failed';

export interface ServerTask {
  id: string;
  name: string;
  detail: string;
  state: TaskState;
  progress: number;
  started: string;
}

const STATE_META: Record<TaskState, { th: string; cls: string; Icon: typeof CircleDashed }> = {
  queued: { th: 'รอคิว', cls: 'text-dim2', Icon: CircleDashed },
  running: { th: 'กำลังทำ', cls: 'text-accent', Icon: Loader2 },
  done: { th: 'เสร็จแล้ว', cls: 'text-[#6BD07C]', Icon: CheckCircle2 },
  failed: { th: 'ล้มเหลว', cls: 'text-[#FF8B7D]', Icon: CircleDashed },
};

const BAR: Record<TaskState, string> = {
  queued: 'bg-line2', running: 'bg-accent', done: 'bg-[#2E7D32]', failed: 'bg-[#E5484D]',
};

/**
 * เซิร์ฟเวอร์ — mockup of the scrape/import queue. No real backend: the task
 * list is static sample data so the layout can be reviewed.
 */
export function ServerPane() {
  return (
    <>
      <div className={`${setSec} !mt-0.5`}>สถานะเซิร์ฟเวอร์</div>
      <div className={frow}>
        <span className={fl}>การเชื่อมต่อ</span>
        <span className="inline-flex items-center gap-[6px] text-[11.5px] font-medium text-accent">
          <span className="relative size-[7px] rounded-full bg-accent after:absolute after:-inset-1 after:animate-pulse2 after:rounded-full after:border after:border-accent after:content-['']" />
          ปกติ · 42ms
        </span>
      </div>
      <div className={frow}>
        <span className={fl}>คิวงานค้าง</span>
        <b className="text-xs font-semibold">{MOCK_TASKS.filter(t => t.state === 'queued').length} งาน</b>
      </div>
      <div className={frow}>
        <span className={fl}>กำลังทำอยู่</span>
        <b className="text-xs font-semibold text-accent">{MOCK_TASKS.filter(t => t.state === 'running').length} งาน</b>
      </div>

      <div className={setSec}>กำลังทำอยู่</div>
      {MOCK_TASKS.filter(t => t.state === 'running' || t.state === 'queued').map(t => (
        <TaskRow key={t.id} task={t} />
      ))}

      <div className={setSec}>รายการงาน</div>
      {MOCK_TASKS.filter(t => t.state === 'done' || t.state === 'failed').map(t => (
        <TaskRow key={t.id} task={t} />
      ))}
    </>
  );
}

function TaskRow({ task }: { task: ServerTask }) {
  const { th, cls, Icon } = STATE_META[task.state];
  return (
    <div className="border-b border-line py-2 last:border-b-0">
      <div className="flex items-center gap-2">
        <Icon size={13} className={`flex-none ${cls} ${task.state === 'running' ? 'animate-spin2' : ''}`} />
        <span className="min-w-0 flex-1 truncate text-[12px]">{task.name}</span>
        <span className={`flex-none font-display text-[10px] font-medium ${cls}`}>{th}</span>
      </div>
      <div className="mt-1 truncate pl-[21px] text-[10.5px] text-dim2">{task.detail}</div>
      <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-panel2">
        <div className={`h-full rounded-full ${BAR[task.state]}`} style={{ width: `${task.progress}%` }} />
      </div>
      <div className="mt-1 flex justify-between pl-[21px] font-display text-[10px] text-dim2">
        <span className="inline-flex items-center gap-1"><Server size={10} />{task.started}</span>
        <span>{task.progress}%</span>
      </div>
    </div>
  );
}

/** Sample queue — replace with the real scraper API when there is one. */
export const MOCK_TASKS: ServerTask[] = [
  { id: 't1', name: 'ดึงข้อมูลประมูล — กรมบังคับคดี', detail: 'หน้า 12 / 48 · เขตกรุงเทพมหานคร', state: 'running', progress: 62, started: 'เริ่ม 09:14' },
  { id: 't2', name: 'ดึงข้อมูลประมูล — กรมที่ดิน', detail: 'กำลังรอคิว', state: 'queued', progress: 0, started: 'รอ' },
  { id: 't3', name: 'อัปเดตโฉนด/แปลงที่ดิน', detail: 'หน้า 8 / 8 · สำเร็จ', state: 'done', progress: 100, started: '08:40' },
  { id: 't4', name: 'ดึงราคาประเมิน — กรมการเงินกลัง', detail: 'เกิดข้อผิดพลาด HTTP 429 (จำกัดอัตรา)', state: 'failed', progress: 24, started: '07:55' },
  { id: 't5', name: 'สร้างดัชนีค้นหา', detail: 'หน้า 3 / 3 · สำเร็จ', state: 'done', progress: 100, started: '07:20' },
];
