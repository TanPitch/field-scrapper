import { Crosshair } from 'lucide-react';
import type { CctvPin } from '../../types';
import { btn } from '../ui/styles';

export function CamScreen({ note }: { note: string }) {
  return (
    <div className="relative grid h-[150px] place-items-center overflow-hidden rounded-[10px] border border-line2 bg-[radial-gradient(120%_120%_at_30%_20%,#1A221A_0%,#0A0D0A_60%,#060806_100%)] before:absolute before:inset-0 before:bg-[repeating-linear-gradient(0deg,rgba(255,255,255,.035)_0_2px,transparent_2px_4px)] before:content-[''] after:absolute after:inset-x-0 after:top-[-40%] after:h-[34%] after:animate-scan after:bg-gradient-to-b after:from-transparent after:via-[rgba(184,241,63,.08)] after:to-transparent after:content-['']">
      <span className="z-[1] ml-1 h-0 w-0 border-y-[10px] border-l-[16px] border-y-transparent border-l-white/85" />
      <span className="absolute inset-x-0 bottom-2 z-[1] text-center text-[10px] text-white/55">{note}</span>
    </div>
  );
}

export function LiveDot({ className = '' }: { className?: string }) {
  return <span className={`inline-block size-2 flex-none animate-pulse2 rounded-full bg-[#FF5252] shadow-[0_0_0_3px_rgba(255,82,82,.22)] ${className}`} />;
}

/** Rendered into the MapLibre popup via createRoot (see map/pins.tsx). */
export function CctvPopup({ pin, onZoom }: { pin: CctvPin; onZoom: () => void }) {
  return (
    <div className="text-white">
      <div className="mb-2 flex items-center gap-[7px] text-xs font-semibold">
        <LiveDot />
        <b>{pin.name}</b>
        <span className="ml-auto font-display text-[10px] font-medium text-dim2">{pin.id}</span>
      </div>
      <CamScreen note="สตรีมวิดีโอ/ภาพ (ตัวอย่าง) — รอเชื่อมอุปกรณ์จริง" />
      <div className="mt-[9px] flex gap-[7px]">
        <button className={btn} onClick={onZoom}><Crosshair size={14} />ซูม</button>
      </div>
    </div>
  );
}
