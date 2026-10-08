import { useApp } from '../../store/useApp';

export function Toasts() {
  const toasts = useApp(s => s.toasts);
  return (
    <div className="pointer-events-none absolute bottom-4 right-3 z-[25] flex flex-col items-end gap-[7px]">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`max-w-[min(300px,80vw)] animate-tin rounded-lg border border-line2 border-l-2 bg-[rgba(11,13,11,.94)] px-3 py-2 text-xs transition-all duration-[250ms] ${
            t.warn ? 'border-l-[#E5484D]' : 'border-l-accent'
          } ${t.out ? 'translate-x-3 opacity-0' : ''}`}
        >
          {t.msg}
        </div>
      ))}
    </div>
  );
}
