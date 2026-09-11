import { Check, ChevronDown, X } from 'lucide-react-native';
import { useState } from 'react';
import { FlatList, Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { useBrand } from '@/features/groups/brand';
import { cn } from '@/lib/cn';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

export interface SelectProps<T extends string> {
  label?: string;
  options: readonly SelectOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  placeholder?: string;
  /** Shows the search box. Defaults on once the list is long enough to scroll. */
  searchable?: boolean;
  disabled?: boolean;
  className?: string;
}

/**
 * A collapsed selector that opens a full-height sheet.
 *
 * `OptionGroup` renders every choice inline, which is right for six payment
 * methods and wrong for two hundred members: the form fields ended up below a
 * screen and a half of names, so recording a payment meant scrolling past the
 * whole group to reach the amount.
 *
 * The answer for a long list is search, not a shorter list and not a native
 * wheel — with two hundred members a picker you can only scroll is no better
 * than what it replaced. So this is one control that collapses to a single row
 * and filters as you type.
 */
export function Select<T extends string>({
  label,
  options,
  value,
  onChange,
  placeholder = 'Choose one',
  searchable,
  disabled,
  className,
}: SelectProps<T>) {
  const brand = useBrand();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = options.find((option) => option.value === value) ?? null;
  const showSearch = searchable ?? options.length > 8;

  const needle = query.trim().toLowerCase();
  const matches =
    needle === ''
      ? options
      : options.filter(
          (option) =>
            option.label.toLowerCase().includes(needle) ||
            (option.hint ?? '').toLowerCase().includes(needle)
        );

  function choose(next: T) {
    onChange(next);
    setOpen(false);
    // Cleared on close, not on open: reopening to correct a mistake should
    // start fresh rather than resume somebody's half-typed search.
    setQuery('');
  }

  return (
    <View className={cn('gap-1.5', className)}>
      {label && <Text variant="label">{label}</Text>}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: Boolean(disabled), expanded: open }}
        accessibilityLabel={label ? `${label}: ${selected?.label ?? placeholder}` : undefined}
        disabled={disabled}
        onPress={() => setOpen(true)}
        className={cn(
          'flex-row items-center gap-2 rounded-lg border border-border bg-background px-4 py-3',
          disabled ? 'opacity-50' : 'active:bg-secondary'
        )}>
        <View className="flex-1">
          <Text variant={selected ? 'label' : 'muted'} numberOfLines={1}>
            {selected?.label ?? placeholder}
          </Text>
          {selected?.hint && (
            <Text variant="caption" numberOfLines={1}>
              {selected.hint}
            </Text>
          )}
        </View>
        <ChevronDown size={18} color="#66756F" />
      </Pressable>

      <Modal
        visible={open}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setOpen(false)}>
        <View className="flex-1 bg-background" style={{ paddingTop: insets.top + 8 }}>
          <View className="flex-row items-center gap-2 px-5 pb-3">
            <Text variant="title" className="flex-1" numberOfLines={1}>
              {label ?? placeholder}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={() => setOpen(false)}
              className="rounded-full bg-secondary p-2">
              <X size={18} color="#66756F" />
            </Pressable>
          </View>

          {showSearch && (
            <View className="px-5 pb-3">
              <Input
                value={query}
                onChangeText={setQuery}
                placeholder="Search"
                autoCorrect={false}
                autoCapitalize="none"
                accessibilityLabel="Search options"
              />
            </View>
          )}

          <FlatList
            data={matches}
            keyExtractor={(option) => option.value}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
            ListEmptyComponent={
              <View className="px-5 py-8">
                <Text variant="caption" className="text-center">
                  Nothing matches “{query.trim()}”.
                </Text>
              </View>
            }
            renderItem={({ item }) => {
              const isSelected = item.value === value;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  onPress={() => choose(item.value)}
                  className="flex-row items-center gap-3 border-b border-border px-5 py-4 active:bg-secondary">
                  <View className="flex-1">
                    <Text variant="label" numberOfLines={1}>
                      {item.label}
                    </Text>
                    {item.hint && (
                      <Text variant="caption" numberOfLines={1}>
                        {item.hint}
                      </Text>
                    )}
                  </View>
                  {isSelected && <Check size={18} color={brand.hex} />}
                </Pressable>
              );
            }}
          />
        </View>
      </Modal>
    </View>
  );
}
