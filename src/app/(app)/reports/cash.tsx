import { ChevronLeft } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MoneyText } from '@/components/shared/money-text';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { useCurrentGroup } from '@/features/groups/current-group';
import { ExportActions } from '@/features/reports/export-actions';
import { reportHtml, toCsv } from '@/features/reports/export';
import { RANGE_LABEL, describeRange, rangeFor, type RangePreset } from '@/features/reports/ranges';
import { useCashByMethod, useCashByPlan, useCashReport } from '@/features/reports/use-reports';
import { formatMoney, type CurrencyCode } from '@/lib/money';
import { goBack } from '@/lib/navigation';

const PRESETS: RangePreset[] = [
  'this-month',
  'last-month',
  'this-quarter',
  'this-year',
  'all-time',
];

/**
 * The cash book: what came in, what went out, and what is left.
 *
 * Opening and closing balances are the point. A single "collected ₵4,000" tells
 * a meeting nothing on its own; opening + in − out = closing is a statement
 * somebody can check, and consecutive months chain exactly because the opening
 * balance is everything strictly before the window.
 */
export default function CashReportScreen() {
  const insets = useSafeAreaInsets();
  const { membership } = useCurrentGroup();

  const [preset, setPreset] = useState<RangePreset>('this-month');

  const range = rangeFor(preset);
  const currency = (membership?.currency ?? 'GHS') as CurrencyCode;

  const report = useCashReport(membership?.groupId, range);
  const byPlan = useCashByPlan(membership?.groupId, range);
  const byMethod = useCashByMethod(membership?.groupId, range);

  const money = (amount: number) => formatMoney(amount, currency);
  const heading = `${membership?.groupName ?? 'Group'} — cash book`;
  const period = describeRange(range);

  function plainText(): string {
    const d = report.data;
    if (!d) return '';

    const lines = [
      heading,
      period,
      '',
      `Opening balance: ${money(d.openingBalance)}`,
      `Money in:        ${money(d.moneyIn)}  (${d.paymentCount} payments)`,
      `Money out:       ${money(d.moneyOut)}  (${d.expenseCount} expenses)`,
      `Closing balance: ${money(d.closingBalance)}`,
    ];

    if ((byPlan.data ?? []).length > 0) {
      lines.push('', 'Collected by contribution:');
      for (const row of byPlan.data!) lines.push(`- ${row.planName}: ${money(row.collected)}`);
    }

    return lines.join('\n');
  }

  const fileName = () => `${membership?.groupName ?? 'Kobox'} cash ${range.from} to ${range.to}`;

  function csvFor(): string {
    const d = report.data;
    const rows: (string | number)[][] = [
      ['Opening balance', (d?.openingBalance ?? 0) / 100],
      ['Money in', (d?.moneyIn ?? 0) / 100],
      ['Money out', (d?.moneyOut ?? 0) / 100],
      ['Closing balance', (d?.closingBalance ?? 0) / 100],
    ];
    for (const row of byPlan.data ?? []) rows.push([row.planName, row.collected / 100]);
    for (const row of byMethod.data ?? []) rows.push([row.method, row.collected / 100]);

    // Major units, not pesewas: a spreadsheet is going to do arithmetic on
    // this, and 400 is what a treasurer expects to see, not 40000.
    return toCsv(['Item', `Amount (${currency})`], rows);
  }

  function htmlFor(): string {
    const d = report.data;

    const rowsHtml = (label: string, entries: { name: string; amount: number }[]) =>
      entries.length === 0
        ? ''
        : `<table><thead><tr><th>${label}</th><th class="num">Amount</th></tr></thead><tbody>` +
          entries
            .map((e) => `<tr><td>${e.name}</td><td class="num">${money(e.amount)}</td></tr>`)
            .join('') +
          '</tbody></table>';

    const body =
      `<table><tbody>` +
      `<tr><td>Opening balance</td><td class="num">${money(d?.openingBalance ?? 0)}</td></tr>` +
      `<tr><td>Money in (${d?.paymentCount ?? 0})</td><td class="num">${money(d?.moneyIn ?? 0)}</td></tr>` +
      `<tr><td>Money out (${d?.expenseCount ?? 0})</td><td class="num">${money(d?.moneyOut ?? 0)}</td></tr>` +
      `<tr class="total"><td>Closing balance</td><td class="num">${money(d?.closingBalance ?? 0)}</td></tr>` +
      `</tbody></table>` +
      rowsHtml(
        'Contribution',
        (byPlan.data ?? []).map((r) => ({ name: r.planName, amount: r.collected }))
      ) +
      rowsHtml(
        'Method',
        (byMethod.data ?? []).map((r) => ({ name: r.method, amount: r.collected }))
      );

    return reportHtml(heading, period, body);
  }

  const d = report.data;

  return (
    <View className="flex-1 bg-background">
      <View
        className="flex-row items-center gap-2 px-5 pb-3"
        style={{ paddingTop: insets.top + 8 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => goBack()}
          className="-ml-2 rounded-full p-2 active:bg-secondary">
          <ChevronLeft size={22} color="#66756F" />
        </Pressable>
        <Text variant="title">Cash book</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        contentContainerClassName="gap-4 px-5 pt-2"
        showsVerticalScrollIndicator={false}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View className="flex-row gap-2 pb-1">
            {PRESETS.map((option) => (
              <Pressable
                key={option}
                accessibilityRole="button"
                accessibilityState={{ selected: preset === option }}
                onPress={() => setPreset(option)}
                className={`rounded-full border px-4 py-2 ${
                  preset === option
                    ? 'border-primary bg-primary/10'
                    : 'border-border active:bg-secondary'
                }`}>
                <Text variant="caption">{RANGE_LABEL[option]}</Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>

        <Text variant="caption">{period}</Text>

        {report.isPending ? (
          <Card>
            <ActivityIndicator />
          </Card>
        ) : (
          <>
            <Card className="gap-2">
              <View className="flex-row items-center justify-between">
                <Text variant="caption">Opening balance</Text>
                <MoneyText amount={d?.openingBalance ?? 0} currency={currency} variant="label" />
              </View>
              <View className="flex-row items-center justify-between">
                <Text variant="caption">Money in ({d?.paymentCount ?? 0})</Text>
                <MoneyText
                  amount={d?.moneyIn ?? 0}
                  currency={currency}
                  variant="label"
                  className="text-success"
                />
              </View>
              <View className="flex-row items-center justify-between">
                <Text variant="caption">Money out ({d?.expenseCount ?? 0})</Text>
                <MoneyText
                  amount={d?.moneyOut ?? 0}
                  currency={currency}
                  variant="label"
                  className="text-destructive"
                />
              </View>
              <View className="flex-row items-center justify-between border-t border-border pt-2">
                <Text variant="label">Closing balance</Text>
                <MoneyText amount={d?.closingBalance ?? 0} currency={currency} variant="heading" />
              </View>
            </Card>

            {(byPlan.data ?? []).length > 0 && (
              <Card className="gap-2">
                <Text variant="label">Collected by contribution</Text>
                {byPlan.data!.map((row) => (
                  <View
                    key={row.planId ?? row.planName}
                    className="flex-row items-center justify-between">
                    <Text variant="caption" numberOfLines={1} className="flex-1 pr-3">
                      {row.planName}
                    </Text>
                    <MoneyText amount={row.collected} currency={currency} variant="label" />
                  </View>
                ))}
              </Card>
            )}

            {(byMethod.data ?? []).length > 0 && (
              <Card className="gap-2">
                <Text variant="label">How it was paid</Text>
                {byMethod.data!.map((row) => (
                  <View key={row.method} className="flex-row items-center justify-between">
                    <Text variant="caption" className="capitalize">
                      {row.method} ({row.paymentCount})
                    </Text>
                    <MoneyText amount={row.collected} currency={currency} variant="label" />
                  </View>
                ))}
              </Card>
            )}

            <ExportActions fileName={fileName} text={plainText} csv={csvFor} html={htmlFor} />
          </>
        )}
      </ScrollView>
    </View>
  );
}
