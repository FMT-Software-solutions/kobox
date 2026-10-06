import { Check, ChevronLeft } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MoneyText } from '@/components/shared/money-text';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { Text } from '@/components/ui/text';
import { useCurrentGroup } from '@/features/groups/current-group';
import { usePlans } from '@/features/plans/use-plans';
import { ExportActions } from '@/features/reports/export-actions';
import { reportHtml, toCsv } from '@/features/reports/export';
import { usePlanMemberReport } from '@/features/reports/use-reports';
import { formatMoney, type CurrencyCode } from '@/lib/money';
import { goBack } from '@/lib/navigation';

/**
 * One contribution, everyone in it, what each has paid.
 *
 * This is the report a group circulates — "Hall Levy, here is who has paid so
 * far, total ₵4,300" — and it is the only one the others cannot approximate:
 * the cash book aggregates across contributions and the arrears list spans all
 * of them.
 */
export default function ContributionReportScreen() {
  const insets = useSafeAreaInsets();
  const { membership } = useCurrentGroup();

  const [planId, setPlanId] = useState<string | null>(null);

  /**
   * Off by default, and only for the export.
   *
   * On screen, everybody belongs: a treasurer needs to see who has not paid.
   * But a shared list is read as a record of what came in, and padding it with
   * a column of zeroes invites the reading that those people were charged
   * nothing — or worse, that they are being named for not paying. The people
   * who paid are the report; the rest are a chase list, which is a different
   * document with a different audience.
   */
  const [includeUnpaid, setIncludeUnpaid] = useState(false);

  const currency = (membership?.currency ?? 'GHS') as CurrencyCode;
  const plans = usePlans(membership?.groupId);
  const rows = usePlanMemberReport(planId ?? undefined);

  const planOptions = (plans.data ?? []).map((plan) => ({
    value: plan.id,
    label: plan.name,
    hint: plan.status === 'active' ? undefined : plan.status,
  }));

  const plan = plans.data?.find((p) => p.id === planId) ?? null;
  const data = rows.data ?? [];
  const totalPaid = data.reduce((sum, row) => sum + row.totalPaid, 0);
  const totalDue = data.reduce((sum, row) => sum + row.totalDue, 0);
  const paidCount = data.filter((row) => row.totalPaid > 0).length;

  const money = (amount: number) => formatMoney(amount, currency);
  const heading = plan?.name ?? 'Contribution';
  const asOf = `${membership?.groupName ?? ''} · as at ${new Date().toLocaleDateString('en-GB')}`;

  // What actually leaves the app. The screen always shows everybody.
  const exported = includeUnpaid ? data : data.filter((row) => row.totalPaid > 0);
  const exportedTotal = exported.reduce((sum, row) => sum + row.totalPaid, 0);

  function csvFor(): string {
    return toCsv(
      ['#', 'Member', `Expected (${currency})`, `Paid (${currency})`, `Owing (${currency})`],
      exported.map((row, index) => [
        index + 1,
        row.fullName,
        row.totalDue / 100,
        row.totalPaid / 100,
        row.balance / 100,
      ])
    );
  }

  function htmlFor(): string {
    const body =
      `<table><thead><tr><th>#</th><th>Member</th><th class="num">Paid</th><th class="num">Owing</th></tr></thead><tbody>` +
      exported
        .map(
          (row, index) =>
            `<tr><td>${index + 1}</td><td>${row.fullName}</td>` +
            `<td class="num">${money(row.totalPaid)}</td>` +
            `<td class="num">${row.balance > 0 ? money(row.balance) : '—'}</td></tr>`
        )
        .join('') +
      `<tr class="total"><td></td><td>Total (${exported.length} listed)</td>` +
      `<td class="num">${money(exportedTotal)}</td><td class="num">${money(totalDue - totalPaid)}</td></tr>` +
      `</tbody></table>`;

    return reportHtml(heading, asOf, body);
  }

  const fileName = () => `${heading} ${new Date().toISOString().slice(0, 10)}`;

  function textFor(): string {
    const lines = [heading, asOf, ''];
    // Numbered, because this gets read out and people look for their name.
    exported.forEach((row, index) => {
      lines.push(`${index + 1}. ${row.fullName} — ${money(row.totalPaid)}`);
    });
    lines.push('', `Total collected: ${money(exportedTotal)}`);
    lines.push(`${paidCount} of ${data.length} have paid`);
    return lines.join('\n');
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
        <Text variant="title">By contribution</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        contentContainerClassName="gap-3 px-5 pt-2"
        showsVerticalScrollIndicator={false}>
        <Select
          label="Which contribution?"
          placeholder="Choose a contribution"
          options={planOptions}
          value={planId}
          onChange={setPlanId}
        />

        {planId === null ? (
          <Card>
            <Text variant="caption">
              Pick a contribution to see who has paid towards it and how much has come in.
            </Text>
          </Card>
        ) : rows.isPending ? (
          <Card>
            <ActivityIndicator />
          </Card>
        ) : (
          <>
            <Card className="gap-1">
              <Text variant="caption">Collected so far</Text>
              <MoneyText amount={totalPaid} currency={currency} variant="display" />
              <Text variant="caption">
                {paidCount} of {data.length} {data.length === 1 ? 'member has' : 'members have'}{' '}
                paid
              </Text>
            </Card>

            <Card className="gap-0 p-0">
              {data.map((row, index) => (
                <View
                  key={row.memberId}
                  className={`flex-row items-center gap-3 p-4 ${
                    index > 0 ? 'border-t border-border' : ''
                  }`}>
                  <Text variant="caption" className="w-6">
                    {index + 1}
                  </Text>
                  <View className="flex-1">
                    <Text variant="label" numberOfLines={1}>
                      {row.fullName}
                    </Text>
                    {row.balance > 0 && <Text variant="caption">Owing {money(row.balance)}</Text>}
                  </View>
                  <MoneyText
                    amount={row.totalPaid}
                    currency={currency}
                    variant="label"
                    className={row.totalPaid > 0 ? 'text-success' : 'text-muted-foreground'}
                  />
                </View>
              ))}

              <View className="flex-row items-center gap-3 border-t-2 border-foreground p-4">
                <Text variant="label" className="flex-1">
                  Total
                </Text>
                <MoneyText amount={totalPaid} currency={currency} variant="heading" />
              </View>
            </Card>

            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: includeUnpaid }}
              accessibilityLabel="Include members who have not paid in the export"
              onPress={() => setIncludeUnpaid((on) => !on)}
              className="mt-2 flex-row items-center gap-3 rounded-lg border border-border p-3 active:bg-secondary">
              <View
                className={`h-5 w-5 items-center justify-center rounded border ${
                  includeUnpaid ? 'border-primary bg-primary' : 'border-border'
                }`}>
                {includeUnpaid && <Check size={14} color="white" />}
              </View>
              <View className="flex-1">
                <Text variant="label">Include members who have not paid</Text>
                <Text variant="caption">
                  {includeUnpaid
                    ? `All ${data.length} listed, zeroes included.`
                    : `Only the ${paidCount} who paid. This is what gets shared.`}
                </Text>
              </View>
            </Pressable>

            <ExportActions fileName={fileName} text={textFor} csv={csvFor} html={htmlFor} />
          </>
        )}
      </ScrollView>
    </View>
  );
}
