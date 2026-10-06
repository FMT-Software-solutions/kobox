import { ChevronLeft } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MoneyText } from '@/components/shared/money-text';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Select } from '@/components/ui/select';
import { Text } from '@/components/ui/text';
import { useCurrentGroup } from '@/features/groups/current-group';
import { useMembers } from '@/features/members/use-members';
import { useMemberPayments, useOutstanding } from '@/features/payments/use-payments';
import { ExportActions } from '@/features/reports/export-actions';
import { reportHtml, toCsv } from '@/features/reports/export';
import { formatMoney, type CurrencyCode } from '@/lib/money';
import { goBack } from '@/lib/navigation';

/**
 * One member's whole position: what they have paid, what they still owe broken
 * down by period, and how they are doing overall.
 *
 * The "performance" figure is deliberately paid ÷ expected and nothing cleverer.
 * Anything weighted or scored would need explaining to somebody being shown it
 * as a reason they are behind, and a number a treasurer cannot defend in a
 * meeting is worse than no number.
 */
export default function MemberReportScreen() {
  const insets = useSafeAreaInsets();
  const { membership } = useCurrentGroup();

  const [memberId, setMemberId] = useState<string | null>(null);

  const currency = (membership?.currency ?? 'GHS') as CurrencyCode;
  const members = useMembers(membership?.groupId);
  const payments = useMemberPayments(memberId ?? undefined);
  const outstanding = useOutstanding(membership?.groupId, memberId ?? undefined);

  const member = members.data?.find((m) => m.id === memberId) ?? null;

  const memberOptions = (members.data ?? []).map((m) => ({
    value: m.id,
    label: m.fullName,
    hint: m.balance > 0 ? `Owes ${formatMoney(m.balance, currency)}` : 'Paid up',
  }));

  const owed = outstanding.data ?? [];
  const history = payments.data ?? [];

  const expected = member?.totalDue ?? 0;
  const paid = member?.totalPaid ?? 0;
  const percent = expected === 0 ? 100 : Math.min(100, Math.round((paid / expected) * 100));

  // Named bands, because "68%" alone invites an argument about whether that is
  // good. A word sets the expectation the number is measured against.
  const level =
    expected === 0
      ? 'Nothing due yet'
      : percent >= 100
        ? 'Fully paid up'
        : percent >= 75
          ? 'Mostly up to date'
          : percent >= 40
            ? 'Falling behind'
            : 'Well behind';

  const money = (amount: number) => formatMoney(amount, currency);
  const heading = member?.fullName ?? 'Member';
  const asOf = `${membership?.groupName ?? ''} · as at ${new Date().toLocaleDateString('en-GB')}`;

  const fileName = () => `${heading} statement ${new Date().toISOString().slice(0, 10)}`;

  function textFor(): string {
    const lines = [
      `${heading} — statement`,
      asOf,
      '',
      `Expected: ${money(expected)}`,
      `Paid:     ${money(paid)}`,
      `Owing:    ${money(member?.balance ?? 0)}`,
      `Standing: ${level} (${percent}%)`,
    ];

    if (owed.length > 0) {
      lines.push('', 'Still owing:');
      for (const row of owed) {
        lines.push(`- ${row.planName} ${row.cycleLabel}: ${money(row.balance)}`);
      }
    }

    return lines.join('\n');
  }

  function csvFor(): string {
    return toCsv(
      ['Date', 'Contribution', 'Method', 'Status', `Amount (${currency})`],
      history.map((row) => [
        row.paidAt.slice(0, 10),
        row.planName ?? 'Not earmarked',
        row.method,
        row.status,
        row.amount / 100,
      ])
    );
  }

  function htmlFor(): string {
    const owedRows =
      owed.length === 0
        ? ''
        : `<table><thead><tr><th>Still owing</th><th>Period</th><th class="num">Amount</th></tr></thead><tbody>` +
          owed
            .map(
              (row) =>
                `<tr><td>${row.planName}</td><td>${row.cycleLabel}</td><td class="num">${money(row.balance)}</td></tr>`
            )
            .join('') +
          `<tr class="total"><td>Total owing</td><td></td><td class="num">${money(member?.balance ?? 0)}</td></tr>` +
          `</tbody></table>`;

    const paymentRows =
      history.length === 0
        ? '<p>No payments recorded.</p>'
        : `<table><thead><tr><th>Date</th><th>Contribution</th><th>Method</th><th class="num">Amount</th></tr></thead><tbody>` +
          history
            .map(
              (row) =>
                `<tr><td>${new Date(row.paidAt).toLocaleDateString('en-GB')}</td>` +
                `<td>${row.planName ?? 'Not earmarked'}</td><td>${row.method}</td>` +
                `<td class="num">${money(row.amount)}</td></tr>`
            )
            .join('') +
          `<tr class="total"><td>Total paid</td><td></td><td></td><td class="num">${money(paid)}</td></tr>` +
          `</tbody></table>`;

    return reportHtml(heading, `${asOf} · ${level} (${percent}%)`, owedRows + paymentRows);
  }

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
        <Text variant="title">By member</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        contentContainerClassName="gap-3 px-5 pt-2"
        showsVerticalScrollIndicator={false}>
        <Select
          label="Which member?"
          placeholder="Choose a member"
          options={memberOptions}
          value={memberId}
          onChange={setMemberId}
        />

        {memberId === null ? (
          <Card>
            <Text variant="caption">
              Pick a member to see everything they have paid and everything they still owe.
            </Text>
          </Card>
        ) : payments.isPending || outstanding.isPending ? (
          <Card>
            <ActivityIndicator />
          </Card>
        ) : (
          <>
            <Card className="gap-3">
              <View className="flex-row items-end justify-between">
                <View>
                  <Text variant="caption">Paid of expected</Text>
                  <MoneyText amount={paid} currency={currency} variant="display" />
                  <Text variant="caption">of {money(expected)}</Text>
                </View>
                <View className="items-end">
                  <Text variant="heading">{percent}%</Text>
                  <Text variant="caption">{level}</Text>
                </View>
              </View>
              <Progress
                value={percent}
                label="Contribution progress"
                indicatorClassName={percent >= 100 ? 'bg-success' : 'bg-warning'}
              />
            </Card>

            {owed.length > 0 && (
              <View className="gap-2">
                <Text variant="label">Still owing {money(member?.balance ?? 0)}</Text>
                <Card className="gap-0 p-0">
                  {owed.map((row, index) => (
                    <View
                      key={row.obligationId}
                      className={`flex-row items-center gap-3 p-4 ${
                        index > 0 ? 'border-t border-border' : ''
                      }`}>
                      <View className="flex-1">
                        <Text variant="label" numberOfLines={1}>
                          {row.planName}
                        </Text>
                        <Text variant="caption">{row.cycleLabel}</Text>
                      </View>
                      <MoneyText
                        amount={row.balance}
                        currency={currency}
                        variant="label"
                        className="text-warning"
                      />
                    </View>
                  ))}
                </Card>
              </View>
            )}

            <View className="gap-2">
              <Text variant="label">Payments</Text>
              {history.length === 0 ? (
                <Card>
                  <Text variant="caption">Nothing recorded yet.</Text>
                </Card>
              ) : (
                <Card className="gap-0 p-0">
                  {history.map((row, index) => (
                    <View
                      key={row.id}
                      className={`flex-row items-center gap-3 p-4 ${
                        index > 0 ? 'border-t border-border' : ''
                      }`}>
                      <View className="flex-1">
                        <Text variant="label">
                          {new Date(row.paidAt).toLocaleDateString('en-GB')}
                        </Text>
                        <Text variant="caption" numberOfLines={1}>
                          <Text variant="caption" className="capitalize">
                            {row.method}
                          </Text>
                          {row.planName ? ` · ${row.planName}` : ''}
                        </Text>
                      </View>
                      <View className="items-end gap-1">
                        <MoneyText amount={row.amount} currency={currency} variant="label" />
                        {row.status === 'reversed' && <Badge label="Reversed" tone="danger" />}
                        {row.status === 'pending' && <Badge label="Pending" tone="warning" />}
                      </View>
                    </View>
                  ))}
                </Card>
              )}
            </View>

            <ExportActions fileName={fileName} text={textFor} csv={csvFor} html={htmlFor} />
          </>
        )}
      </ScrollView>
    </View>
  );
}
