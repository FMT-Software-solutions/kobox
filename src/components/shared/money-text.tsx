import { Text, type TextProps } from '@/components/ui/text';
import { cn } from '@/lib/cn';
import { formatMoney, type CurrencyCode, type Minor } from '@/lib/money';

export interface MoneyTextProps extends Omit<TextProps, 'children'> {
  amount: Minor;
  currency?: CurrencyCode;
  showSymbol?: boolean;
  /**
   * Colour the amount by sign — green when money is in, red when owed.
   * Off by default so neutral figures (a plan's amount) don't read as a verdict.
   */
  signed?: boolean;
  /** Prefix positive values with "+". Only meaningful with `signed`. */
  showPlus?: boolean;
}

export function MoneyText({
  amount,
  currency,
  showSymbol = true,
  signed = false,
  showPlus = false,
  className,
  style,
  ...props
}: MoneyTextProps) {
  const formatted = formatMoney(amount, currency, { showSymbol });
  const prefix = showPlus && amount > 0 ? '+' : '';

  const tone = signed
    ? amount > 0
      ? 'text-success'
      : amount < 0
        ? 'text-destructive'
        : 'text-muted-foreground'
    : undefined;

  return (
    <Text
      // Tabular figures keep digits aligned down a column of amounts.
      style={[{ fontVariant: ['tabular-nums'] }, style]}
      className={cn(tone, className)}
      {...props}>
      {prefix}
      {formatted}
    </Text>
  );
}
