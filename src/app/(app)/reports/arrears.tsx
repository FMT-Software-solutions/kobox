import { useRouter } from 'expo-router';
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
import { useArrears } from '@/features/reports/use-reports';
import { formatMoney, type CurrencyCode } from '@/lib/money';
import { formatGhanaPhone } from '@/lib/phone';

/**
 * "All periods" first, because that is the usual question and the only one with
 * a completely unambiguous answer. The ranges narrow to periods that STARTED in
 * the window — not to a balance on a date, which cannot be reconstructed once
 * somebody has paid.
 */
const ARREARS_PRESETS: (RangePreset | 'all')[] = [
  'all',
  'this-month',
  'last-month',
  'this-quarter',
  'this-year',
];

/**
 * Who is behind, worst first.
 *
 * No date range, deliberately: arrears are a position rather than a flow, and
 * "who was behind in June" has no honest answer once they have since paid.
 * Ordered by balance because a chase list is only useful in the order you would
 * actually work it.
 */
export default function ArrearsReportScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { membership } = useCurrentGroup();

  // 'all' is the default and the honest one: arrears are a position, and most
  // of the time the question is simply who is behind right now. A range narrows
  // it to the PERIODS that started inside it.
  const [preset, setPreset] = useState<RangePreset | 'all'>('all');
  const range = preset === 'all' ? undefined : rangeFor(preset);

  const currency = (membership?.currency ?? 'GHS') as CurrencyCode;
  const arrears = useArrears(membership?.groupId, range);

  const rows = arrears.data ?? [];
  const behind = rows.filter((row) => row.balance > 0);
  const owed = behind.reduce((sum, row) => sum + row.balance, 0);

  const money = (amount: number) => formatMoney(amount, currency);
  const heading = `${membership?.groupName ?? 'Group'} — who owes what`;
  const asOf =
    range === undefined
      ? `As at ${new Date().toLocaleDateString('en-GB')}`
      : `Periods starting ${describeRange(range)}`;

  const fileName = () =>
    `${membership?.groupName ?? 'Kobox'} arrears ${new Date().toISOString().slice(0, 10)}`;

  function textFor(): string {
    const lines = [heading, asOf, '', `${behind.length} behind · ${money(owed)} outstanding`, ''];
    for (const row of behind) {
      lines.push(`${row.fullName}: ${money(row.balance)} (${row.periodsOwed} periods)`);
    }
    if (behind.length === 0) lines.push('Everybody is paid up.');
    return lines.join('\n');
  }

  function csvFor(): string {
    // Every member, not just those behind — a spreadsheet is where somebody
    // sorts and filters for themselves, and a partial export cannot be
    // reconciled against the group's own list.
    return toCsv(
      [
        'Member',
        'Phone',
        'Role',
        `Expected (${currency})`,
        `Paid (${currency})`,
        `Owing (${currency})`,
        `Credit (${currency})`,
        'Periods owed',
        'Last payment',
      ],
      rows.map((row) => [
        row.fullName,
        row.phone ?? '',
        row.role,
        row.totalDue / 100,
        row.totalPaid / 100,
        row.balance / 100,
        row.credit / 100,
        row.periodsOwed,
        row.lastPaidAt ? row.lastPaidAt.slice(0, 10) : '',
      ])
    );
  }

  function htmlFor(): string {
    const body =
      `<table><thead><tr><th>Member</th><th class="num">Owing</th><th class="num">Periods</th><th>Last payment</th></tr></thead><tbody>` +
      rows
        .map(
          (row) =>
            `<tr><td>${row.fullName}</td><td class="num">${money(row.balance)}</td>` +
            `<td class="num">${row.periodsOwed}</td>` +
            `<td>${row.lastPaidAt ? new Date(row.lastPaidAt).toLocaleDateString('en-GB') : '—'}</td></tr>`
        )
        .join('') +
      `<tr class="total"><td>${behind.length} behind</td><td class="num">${money(owed)}</td><td></td><td></td></tr>` +
      `</tbody></table>`;

    return reportHtml(heading, asOf, body);
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
        <Text variant="title">Who owes what</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        contentContainerClassName="gap-3 px-5 pt-2"
        showsVerticalScrollIndicator={false}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View className="flex-row gap-2 pb-1">
            {ARREARS_PRESETS.map((option) => (
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
                <Text variant="caption">
                  {option === 'all' ? 'All periods' : RANGE_LABEL[option]}
                </Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>

        <Text variant="caption">{asOf}</Text>

        {arrears.isPending ? (
          <Card>
            <ActivityIndicator />
          </Card>
        ) : (
          <>
            <Card className="gap-1">
              <Text variant="caption">Outstanding across the group</Text>
              <MoneyText amount={owed} currency={currency} variant="display" />
              <Text variant="caption">
                {behind.length === 0
                  ? 'Everybody is paid up.'
                  : `${behind.length} of ${rows.length} ${
                      behind.length === 1 ? 'member is' : 'members are'
                    } behind`}
              </Text>
            </Card>

            {rows.map((row) => (
              <Card key={row.memberId} className="flex-row items-center gap-3">
                <View className="flex-1">
                  <Text variant="label" numberOfLines={1}>
                    {row.fullName}
                  </Text>
                  <Text variant="caption" numberOfLines={1}>
                    {row.phone ? formatGhanaPhone(row.phone) : 'No number'}
                    {row.lastPaidAt
                      ? ` · last paid ${new Date(row.lastPaidAt).toLocaleDateString('en-GB')}`
                      : ' · never paid'}
                  </Text>
                </View>
                <View className="items-end">
                  {row.balance > 0 ? (
                    <>
                      <MoneyText
                        amount={row.balance}
                        currency={currency}
                        variant="label"
                        className="text-warning"
                      />
                      <Text variant="caption">
                        {row.periodsOwed} {row.periodsOwed === 1 ? 'period' : 'periods'}
                      </Text>
                    </>
                  ) : row.credit > 0 ? (
                    <>
                      <MoneyText
                        amount={row.credit}
                        currency={currency}
                        variant="label"
                        className="text-primary"
                      />
                      <Text variant="caption">paid ahead</Text>
                    </>
                  ) : (
                    <Text variant="caption" className="text-success">
                      Paid up
                    </Text>
                  )}
                </View>
              </Card>
            ))}

            <ExportActions fileName={fileName} text={textFor} csv={csvFor} html={htmlFor} />
          </>
        )}
      </ScrollView>
    </View>
  );
}
