import { Check, Undo2, X } from 'lucide-react';
import { useTipProps } from '../ui/Tip';
import { cancelDraw, finishArea, finishDraw, stopEdit, undoDrawPoint } from '../../map/drawEngine';
import { toast, useApp } from '../../store/useApp';
import { btn, btnAcc } from '../ui/styles';

/** Floating drawing toolbar: live measurement · undo · finish · cancel. */
export function DrawBar() {
  const drawMode = useApp(s => s.drawMode);
  const editing = useApp(s => s.editingDraw);
  const info = useApp(s => s.drawInfo);
  const active = drawMode != null || editing != null;

  const done = () => {
    if (editing != null) { stopEdit(); toast('บันทึกการแก้ไขแล้ว'); }
    else if (drawMode === 'area') finishArea();
    else finishDraw();
  };

  return (
    <div
      className={`fs-panel absolute left-1/2 top-3 z-[16] flex max-w-[calc(100%-16px)] flex-nowrap items-center justify-center gap-[9px] whitespace-nowrap rounded-[11px] border border-accent bg-[rgba(11,13,11,.92)] py-1.5 pl-3 pr-2 backdrop-blur transition-all duration-[250ms] ${
        active ? 'pointer-events-auto -translate-x-1/2 translate-y-0 opacity-100' : 'pointer-events-none -translate-x-1/2 -translate-y-3.5 opacity-0'
      }`}
    >
      <span className="font-display text-[11.5px] font-semibold text-accent">{info}</span>
      {drawMode != null && editing == null && (
        <button className={btn} {...useTipProps('เลิกทำจุดล่าสุด')} onClick={undoDrawPoint}><Undo2 size={14} /></button>
      )}
      <button className={btnAcc} onClick={done}><Check size={14} />{editing != null ? 'บันทึก' : 'เสร็จสิ้น'}</button>
      <button className={btn} onClick={() => (editing != null ? stopEdit() : cancelDraw())}><X size={14} /></button>
    </div>
  );
}
