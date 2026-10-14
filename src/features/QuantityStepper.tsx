import { Minus, Plus } from 'lucide-react';
export default function QuantityStepper({
  value,
  onChange,
  label,
  min = 0,
  max = 9999,
  disabled = false,
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
  min?: number;
  max?: number;
  disabled?: boolean;
}) {
  const change = (next: number) => {
    if (Number.isFinite(next))
      onChange(Math.min(max, Math.max(min, Math.floor(next))));
  };
  return (
    <div className="quantity-stepper" role="group" aria-label={label}>
      <button
        type="button"
        aria-label={`Diminuir ${label.toLowerCase()}`}
        disabled={disabled || value <= min}
        onClick={() => change(value - 1)}
      >
        <Minus size={17} />
      </button>
      <input
        aria-label={label}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(e) => change(Number(e.target.value))}
      />
      <button
        type="button"
        aria-label={`Aumentar ${label.toLowerCase()}`}
        disabled={disabled || value >= max}
        onClick={() => change(value + 1)}
      >
        <Plus size={17} />
      </button>
    </div>
  );
}
