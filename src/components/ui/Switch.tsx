import { useTipProps } from './Tip';

interface SwitchProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  title?: string;
  className?: string;
}

export function Switch({ checked, onChange, disabled, title, className = '' }: SwitchProps) {
  return (
    <input
      type="checkbox"
      {...useTipProps(title)}
      checked={checked}
      disabled={disabled}
      onChange={e => onChange(e.target.checked)}
      className={`relative m-0 h-[18px] w-8 shrink-0 cursor-pointer appearance-none rounded-full bg-line2 transition-colors before:absolute before:left-0.5 before:top-0.5 before:size-3.5 before:rounded-full before:bg-[#C8CEC2] before:transition before:content-[''] checked:bg-accent checked:before:translate-x-3.5 checked:before:bg-accent-ink disabled:cursor-default disabled:opacity-40 ${className}`}
    />
  );
}
