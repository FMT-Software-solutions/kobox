import { View } from 'react-native';

import { cn } from '@/lib/cn';

export interface ProgressProps {
  /** 0–100. Values outside the range are clamped. */
  value: number;
  className?: string;
  indicatorClassName?: string;
  label?: string;
}

export function Progress({ value, className, indicatorClassName, label }: ProgressProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: clamped }}
      accessibilityLabel={label}
      className={cn('h-2 w-full overflow-hidden rounded-full bg-muted', className)}>
      <View
        className={cn('h-full rounded-full bg-primary', indicatorClassName)}
        style={{ width: `${clamped}%` }}
      />
    </View>
  );
}
