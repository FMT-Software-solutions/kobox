import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { cn } from '@/lib/cn';

export interface Option<T extends string> {
  value: T;
  label: string;
  hint?: string;
  /** Shown but not choosable — for something that exists but is not open yet. */
  disabled?: boolean;
  /** A short tag beside the label, e.g. "Coming soon". */
  badge?: string;
}

export interface OptionGroupProps<T extends string> {
  label?: string;
  options: readonly Option<T>[];
  value: T;
  onChange: (value: T) => void;
}

/**
 * A wrapping set of large tap targets instead of a dropdown.
 *
 * Native pickers hide every choice behind a tap and read poorly to someone who
 * is not confident with phones. Showing all the options at once is the whole
 * point — you can see what a "susu rotation" is next to "monthly dues" and pick.
 */
export function OptionGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: OptionGroupProps<T>) {
  return (
    <View className="gap-2">
      {label && <Text variant="label">{label}</Text>}

      <View className="flex-row flex-wrap gap-2">
        {options.map((option) => {
          const isSelected = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected, disabled: Boolean(option.disabled) }}
              disabled={option.disabled}
              onPress={() => onChange(option.value)}
              className={cn(
                'rounded-lg border px-4 py-3',
                isSelected ? 'border-primary bg-primary' : 'border-border bg-card',
                option.disabled && 'opacity-50'
              )}>
              <View className="flex-row items-center gap-1.5">
                <Text
                  variant="label"
                  className={isSelected ? 'text-primary-foreground' : 'text-foreground'}>
                  {option.label}
                </Text>
                {option.badge && (
                  <View className="rounded-full bg-secondary px-1.5 py-0.5">
                    <Text className="text-[10px] font-semibold text-secondary-foreground">
                      {option.badge}
                    </Text>
                  </View>
                )}
              </View>
              {option.hint && (
                <Text
                  variant="caption"
                  className={isSelected ? 'text-primary-foreground/80' : undefined}>
                  {option.hint}
                </Text>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
