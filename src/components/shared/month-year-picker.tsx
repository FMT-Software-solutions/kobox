import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { cn } from '@/lib/cn';

/** Short month names, exported so callers can describe a span in the same words. */
export const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

export interface MonthYearPickerProps {
  label?: string;
  /** Zero-based month, as in JavaScript Date. */
  month: number;
  year: number;
  onChange: (next: { month: number; year: number }) => void;
  /** How many past years to offer. */
  yearsBack?: number;
}

/**
 * Month and year selection without a native date picker.
 *
 * A native picker would pull in native code and force another development-build
 * rebuild, and it is the wrong shape anyway: contributions start at the top of a
 * period, not on an arbitrary day, so offering a day of the month would invite
 * a choice that does not mean anything.
 */
export function MonthYearPicker({
  label,
  month,
  year,
  onChange,
  yearsBack = 2,
}: MonthYearPickerProps) {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: yearsBack + 1 }, (_, i) => currentYear - yearsBack + i);

  return (
    <View className="gap-2">
      {label && <Text variant="label">{label}</Text>}

      <View className="flex-row gap-2">
        {years.map((option) => {
          const isSelected = option === year;
          return (
            <Pressable
              key={option}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected }}
              onPress={() => onChange({ month, year: option })}
              className={cn(
                'rounded-lg border px-4 py-2',
                isSelected ? 'border-primary bg-primary' : 'border-border bg-card'
              )}>
              <Text
                variant="label"
                className={isSelected ? 'text-primary-foreground' : 'text-foreground'}>
                {option}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View className="flex-row flex-wrap gap-2">
        {MONTHS.map((name, index) => {
          const isSelected = index === month;
          return (
            <Pressable
              key={name}
              accessibilityRole="radio"
              accessibilityLabel={`${name} ${year}`}
              accessibilityState={{ selected: isSelected }}
              onPress={() => onChange({ month: index, year })}
              className={cn(
                'w-[22%] items-center rounded-lg border py-2',
                isSelected ? 'border-primary bg-primary' : 'border-border bg-card'
              )}>
              <Text
                variant="label"
                className={isSelected ? 'text-primary-foreground' : 'text-foreground'}>
                {name}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
