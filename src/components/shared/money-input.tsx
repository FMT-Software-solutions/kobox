import { useState } from 'react';
import { View } from 'react-native';

import { Input, type InputProps } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { currencyMeta, formatMoney, parseMoney, type CurrencyCode, type Minor } from '@/lib/money';

export interface MoneyInputProps extends Omit<
  InputProps,
  'value' | 'onChange' | 'onChangeText' | 'error'
> {
  label?: string;
  currency?: CurrencyCode;
  /** Amount in minor units, or null when the field is empty or invalid. */
  value: Minor | null;
  onChange: (value: Minor | null) => void;
  error?: string | null;
}

/**
 * Keeps the raw text the user typed separate from the parsed integer amount.
 *
 * Reformatting the field on every keystroke fights the user — typing "12." would
 * instantly become "12.00" and strand the cursor. So the text is theirs to control,
 * and we only surface the parsed interpretation underneath as confirmation.
 */
export function MoneyInput({
  label,
  currency = 'GHS',
  value,
  onChange,
  error,
  ...props
}: MoneyInputProps) {
  const [text, setText] = useState(() =>
    value === null ? '' : formatMoney(value, currency, { showSymbol: false })
  );

  function handleChange(next: string) {
    setText(next);
    onChange(next.trim() === '' ? null : parseMoney(next, currency));
  }

  const showsPreview = text.trim() !== '' && value !== null;
  const isUnparseable = text.trim() !== '' && value === null;

  return (
    <View className="gap-1.5">
      <Input
        label={label}
        value={text}
        onChangeText={handleChange}
        keyboardType="decimal-pad"
        inputMode="decimal"
        placeholder={`0.${'0'.repeat(currencyMeta(currency).decimals)}`}
        error={error ?? (isUnparseable ? 'Enter a valid amount' : null)}
        {...props}
      />

      {showsPreview && (
        <Text variant="caption">{formatMoney(value, currency, { showCode: true })}</Text>
      )}
    </View>
  );
}
