import { ChevronDown } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/cn';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** Row height, also used to scroll the selected value into view when opening. */
const ROW_HEIGHT = 44;

export interface DateParts {
  day: number;
  month: number;
  year: number;
}

export interface DateFieldProps {
  label?: string;
  value: DateParts;
  onChange: (next: DateParts) => void;
  yearsBack?: number;
  yearsForward?: number;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function formatValue({ day, month, year }: DateParts): string {
  return `${day} ${MONTHS[month]} ${year}`;
}

function Column<T extends number>({
  values,
  selected,
  render,
  onSelect,
}: {
  values: readonly T[];
  selected: T;
  render: (value: T) => string;
  onSelect: (value: T) => void;
}) {
  const ref = useRef<ScrollView>(null);

  useEffect(() => {
    const index = values.indexOf(selected);
    if (index < 0) return;
    // Land the selection near the top rather than making the user hunt for it.
    const timer = setTimeout(
      () => ref.current?.scrollTo({ y: Math.max(0, (index - 1) * ROW_HEIGHT), animated: false }),
      0
    );
    return () => clearTimeout(timer);
    // Only on mount: re-scrolling on every change would fight the user's scrolling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ScrollView
      ref={ref}
      className="flex-1"
      showsVerticalScrollIndicator={false}
      contentContainerClassName="py-1">
      {values.map((value) => {
        const isSelected = value === selected;
        return (
          <Pressable
            key={value}
            accessibilityRole="radio"
            accessibilityState={{ selected: isSelected }}
            onPress={() => onSelect(value)}
            style={{ height: ROW_HEIGHT }}
            className={cn(
              'items-center justify-center rounded-md',
              isSelected ? 'bg-primary' : 'active:bg-secondary'
            )}>
            <Text
              variant="label"
              className={isSelected ? 'text-primary-foreground' : 'text-foreground'}>
              {render(value)}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/**
 * A compact date field that opens a scrollable day/month/year picker.
 *
 * Deliberately not the native OS picker: `@react-native-community/datetimepicker`
 * ships native code, so adding it invalidates the development build. This gives
 * the same interaction with no rebuild. Swap it out when native modules are next
 * batched together.
 */
export function DateField({
  label,
  value,
  onChange,
  yearsBack = 2,
  yearsForward = 2,
}: DateFieldProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

  const currentYear = new Date().getFullYear();
  const years = Array.from(
    { length: yearsBack + yearsForward + 1 },
    (_, i) => currentYear - yearsBack + i
  );
  const months = MONTHS.map((_, index) => index);
  const days = Array.from({ length: daysInMonth(draft.year, draft.month) }, (_, i) => i + 1);

  function open() {
    setDraft(value);
    setIsOpen(true);
  }

  function commit() {
    // Clamp for months that are shorter than the previously chosen day.
    const limit = daysInMonth(draft.year, draft.month);
    onChange({ ...draft, day: Math.min(draft.day, limit) });
    setIsOpen(false);
  }

  return (
    <View className="gap-1.5">
      {label && <Text variant="label">{label}</Text>}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label ?? 'Date'}: ${formatValue(value)}`}
        onPress={open}
        className="flex-row items-center justify-between rounded-lg border border-border bg-card px-4 py-3 active:opacity-70">
        <Text variant="body">{formatValue(value)}</Text>
        <ChevronDown size={18} color="#9AA8A3" />
      </Pressable>

      <Modal
        visible={isOpen}
        transparent
        animationType="fade"
        // Without this the sheet draws under the status bar on Android's
        // edge-to-edge layout, pushing the buttons off screen.
        statusBarTranslucent
        onRequestClose={() => setIsOpen(false)}>
        <Pressable
          // Insets keep the sheet clear of the notch and gesture bar; the height
          // cap stops the columns growing until Cancel/Done are unreachable.
          style={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }}
          className="flex-1 justify-center bg-black/60 px-6"
          onPress={() => setIsOpen(false)}>
          {/* Absorbs taps so they do not dismiss the sheet. */}
          <Pressable
            onPress={() => {}}
            style={{ maxHeight: windowHeight * 0.7 }}
            className="overflow-hidden rounded-xl border border-border bg-card">
            <View className="border-b border-border px-4 py-3">
              <Text variant="heading">{label ?? 'Choose a date'}</Text>
              <Text variant="caption">{formatValue(draft)}</Text>
            </View>

            <View
              style={{ height: Math.min(260, windowHeight * 0.4) }}
              className="flex-row gap-1 px-2 py-1">
              <Column
                values={days}
                selected={Math.min(draft.day, days.length)}
                render={(d) => String(d)}
                onSelect={(day) => setDraft((prev) => ({ ...prev, day }))}
              />
              <Column
                values={months}
                selected={draft.month}
                render={(m) => MONTHS[m]!.slice(0, 3)}
                onSelect={(month) => setDraft((prev) => ({ ...prev, month }))}
              />
              <Column
                values={years}
                selected={draft.year}
                render={(y) => String(y)}
                onSelect={(year) => setDraft((prev) => ({ ...prev, year }))}
              />
            </View>

            <View className="flex-row gap-2 border-t border-border p-3">
              <Button
                label="Cancel"
                variant="ghost"
                className="flex-1"
                onPress={() => setIsOpen(false)}
              />
              <Button label="Done" className="flex-1" onPress={commit} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
