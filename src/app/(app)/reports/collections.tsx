import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MoneyText } from '@/components/shared/money-text';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { useCurrentGroup } from '@/features/groups/current-group';
import { ExportActions } from '@/features/reports/export-actions';
import { reportHtml, toCsv } from '@/features/reports/export';
import { RANGE_LABEL, describeRange, rangeFor, type RangePreset } from '@/features/reports/ranges';
import { useCollections } from '@/features/reports/use-reports';
import { formatMoney, type CurrencyCode } from '@/lib/money';

const PRESETS: RangePreset[] = [
  'this-month',
  'last-month',
  'this-quarter',
  'this-year',
  'all-time',
];

/**
 * What came in over a window, and from whom.
 *
 * The cash book answers "how much" in totals; this is the rows behind them,
 * grouped by contribution. A treasurer reconciling a month's takings against
 * the names in their notebook needs the names, and no aggregate can be turned
 * back into them.
 */
export default function CollectionsReportScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { membership } = useCurrentGroup();

  const [preset, setPreset] = useState<RangePreset>('this-month');

  const range = rangeFor(preset);
  const currency = (membership?.currency ?? 'GHS') as CurrencyCode;
  const collections = useCollections(membership?.groupId, range);

  const rows = collections.data ?? [];
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  const payers = new Set(rows.map((row) => row.memberId)).size;

  // Grouped by contribution, because that is the question being asked: how much
  // did the Hall Levy bring in this month, and who paid into it.
  const groups = rows.reduce<Record<string, typeof rows>>((acc, row) => {
    (acc[row.planName] ??= []).push(row);
    return acc;
  }, {});

  const money = (amount: number) => formatMoney(amount, currency);
  const heading = `${membership?.groupName ?? 'Group'} — collections`;
  const period = describeRange(range);

  const fileName = () =>
    `${membership?.groupName ?? 'Kobox'} collections ${range.from} to ${range.to}`;

  function textFor(): string {
    const lines = [heading, period, '', `Total: ${money(total)} from ${payers} members`, ''];
    for (const [planName, entries] of Object.entries(groups)) {
      const sum = entries.reduce((s, e) => s + e.amount, 0);
      lines.push(`${planName} — ${money(sum)}`);
      for (const entry of entries) lines.push(`  ${entry.memberName}: ${money(entry.amount)}`);
      lines.push('');
    }
    return lines.join('\n').trim();
  }

  function csvFor(): string {
    return toCsv(
      ['Date', 'Member', 'Contribution', 'Method', 'Status', `Amount (${currency})`],
      rows.map((row) => [
        row.paidAt.slice(0, 10),
        row.memberName,
        row.planName,
        row.method,
        row.status,
        row.amount / 100,
      ])
    );
  }

  function htmlFor(): string {
    const body =
      Object.entries(groups)
        .map(([planName, entries]) => {
          const sum = entries.reduce((s, e) => s + e.amount, 0);
          return (
            `<table><thead><tr><th>${planName}</th><th>Date</th><th class="num">Amount</th></tr></thead><tbody>` +
            entries
              .map(
                (e) =>
                  `<tr><td>${e.memberName}</td><td>${new Date(e.paidAt).toLocaleDateString('en-GB')}</td>` +
                  `<td class="num">${money(e.amount)}</td></tr>`
              )
              .join('') +
            `<tr class="total"><td>Subtotal</td><td></td><td class="num">${money(sum)}</td></tr>` +
            `</tbody></table>`
          );
        })
        .join('') +
      `<table><tbody><tr class="total"><td>Total from ${payers} members</td>` +
      `<td class="num">${money(total)}</td></tr></tbody></table>`;

    return reportHtml(heading, period, body);
  }

  return (
    <View className="flex-1 bg-background">
      <View
        className="flex-row items-center gap-2 px-5 pb-3"
        style={{ paddingTop: insets.top + 8 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => router.back()}
          className="-ml-2 rounded-full p-2 active:bg-secondary">
          <ChevronLeft size={22} color="#66756F" />
        </Pressable>
        <Text variant="title">Collections</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        contentContainerClassName="gap-3 px-5 pt-2"
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

        {collections.isPending ? (
          <Card>
            <ActivityIndicator />
          </Card>
        ) : (
          <>
            <Card className="gap-1">
              <Text variant="caption">{period}</Text>
              <MoneyText amount={total} currency={currency} variant="display" />
              <Text variant="caption">
                {rows.length} {rows.length === 1 ? 'payment' : 'payments'} from {payers}{' '}
                {payers === 1 ? 'member' : 'members'}
              </Text>
            </Card>

            {rows.length === 0 && (
              <Card>
                <Text variant="caption">Nothing was collected in this period.</Text>
              </Card>
            )}

            {Object.entries(groups).map(([planName, entries]) => {
              const sum = entries.reduce((s, e) => s + e.amount, 0);
              return (
                <View key={planName} className="gap-2">
                  <View className="flex-row items-center justify-between">
                    <Text variant="label" className="flex-1" numberOfLines={1}>
                      {planName}
                    </Text>
                    <MoneyText amount={sum} currency={currency} variant="label" />
                  </View>

                  <Card className="gap-0 p-0">
                    {entries.map((entry, index) => (
                      <View
                        key={entry.paymentId}
                        className={`flex-row items-center gap-3 p-4 ${
                          index > 0 ? 'border-t border-border' : ''
                        }`}>
                        <View className="flex-1">
                          <Text variant="label" numberOfLines={1}>
                            {entry.memberName}
                          </Text>
                          <Text variant="caption" numberOfLines={1}>
                            {new Date(entry.paidAt).toLocaleDateString('en-GB')} ·{' '}
                            <Text variant="caption" className="capitalize">
                              {entry.method}
                            </Text>
                          </Text>
                        </View>
                        <View className="items-end gap-1">
                          <MoneyText amount={entry.amount} currency={currency} variant="label" />
                          {entry.status === 'reversed' && <Badge label="Reversed" tone="danger" />}
                        </View>
                      </View>
                    ))}
                  </Card>
                </View>
              );
            })}

            {rows.length > 0 && (
              <ExportActions fileName={fileName} text={textFor} csv={csvFor} html={htmlFor} />
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}
