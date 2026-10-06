import { CheckCircle2, ChevronLeft, Inbox } from 'lucide-react-native';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/shared/empty-state';
import { MoneyText } from '@/components/shared/money-text';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { useMyStanding } from '@/features/dashboard/use-dashboard';
import { useBrand } from '@/features/groups/brand';
import { useCurrentGroup } from '@/features/groups/current-group';
import { useMemberPayments, useOutstanding } from '@/features/payments/use-payments';
import { formatFullDate } from '@/features/plans/labels';
import type { CurrencyCode } from '@/lib/money';
import { goBack } from '@/lib/navigation';

export default function StatementScreen() {
  const brand = useBrand();
  const insets = useSafeAreaInsets();
  const { membership } = useCurrentGroup();

  const currency = (membership?.currency ?? 'GHS') as CurrencyCode;

  const standing = useMyStanding(membership?.memberId);
  const outstanding = useOutstanding(membership?.groupId, membership?.memberId);
  const payments = useMemberPayments(membership?.memberId);

  const isRefreshing = standing.isFetching || outstanding.isFetching || payments.isFetching;

  function refresh() {
    standing.refetch();
    outstanding.refetch();
    payments.refetch();
  }

  const owed = standing.data?.balance ?? 0;
  const credit = standing.data?.credit ?? 0;

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
        <Text variant="title">Your contributions</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        contentContainerClassName="gap-5 px-5 pt-2"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refresh} />}>
        {/* Headline — must equal the figure on the dashboard card */}
        <Card
          className={
            owed > 0 ? 'border-warning/40 bg-warning/10' : 'border-success/30 bg-success/10'
          }>
          <Text variant="caption">{owed > 0 ? 'You owe in total' : 'Your balance'}</Text>
          {owed > 0 ? (
            <MoneyText
              amount={owed}
              currency={currency}
              variant="display"
              className="text-warning"
            />
          ) : (
            <Text variant="display" className="text-success">
              All paid up
            </Text>
          )}

          {credit > 0 && (
            <Text variant="caption" className="mt-1">
              Plus <MoneyText amount={credit} currency={currency} variant="caption" /> paid in
              advance
            </Text>
          )}
        </Card>

        {/* What makes up that total */}
        <View>
          <Text variant="heading" className="mb-3">
            What you owe
          </Text>

          {outstanding.isPending ? (
            <Card>
              <ActivityIndicator />
            </Card>
          ) : (outstanding.data?.length ?? 0) === 0 ? (
            <EmptyState
              icon={<CheckCircle2 size={28} color={brand.hex} />}
              title="Nothing outstanding"
              description="Every contribution due from you has been settled."
            />
          ) : (
            <Card className="gap-0 p-0">
              {outstanding.data!.map((item, index) => (
                <View
                  key={item.obligationId}
                  className={`gap-1 p-4 ${index > 0 ? 'border-t border-border' : ''}`}>
                  <View className="flex-row items-start justify-between gap-3">
                    <View className="flex-1">
                      <Text variant="label" numberOfLines={1}>
                        {item.planName}
                      </Text>
                      <Text variant="caption">{item.cycleLabel}</Text>
                    </View>
                    <MoneyText
                      amount={item.balance}
                      currency={currency}
                      variant="label"
                      className="text-warning"
                    />
                  </View>

                  {/* Part-paid periods should show what has already gone in */}
                  {item.amountPaid > 0 && (
                    <Text variant="caption">
                      <MoneyText amount={item.amountPaid} currency={currency} variant="caption" />{' '}
                      of <MoneyText amount={item.amountDue} currency={currency} variant="caption" />{' '}
                      paid
                    </Text>
                  )}

                  <Text variant="caption">Due {formatFullDate(item.dueDate)}</Text>
                </View>
              ))}
            </Card>
          )}
        </View>

        {/* Everything they have paid */}
        <View>
          <Text variant="heading" className="mb-3">
            Your payments
          </Text>

          {payments.isPending ? (
            <Card>
              <ActivityIndicator />
            </Card>
          ) : (payments.data?.length ?? 0) === 0 ? (
            <EmptyState
              icon={<Inbox size={28} color="#9AA8A3" />}
              title="No payments yet"
              description="Once a payment is recorded for you it appears here."
            />
          ) : (
            <Card className="gap-0 p-0">
              {payments.data!.map((payment, index) => (
                <View
                  key={payment.id}
                  className={`flex-row items-start justify-between gap-3 p-4 ${
                    index > 0 ? 'border-t border-border' : ''
                  }`}>
                  <View className="flex-1">
                    <Text variant="label" numberOfLines={1}>
                      {payment.planName ?? 'General payment'}
                    </Text>
                    <Text variant="caption" numberOfLines={1}>
                      <Text variant="caption" className="capitalize">
                        {payment.method}
                      </Text>
                      {' · '}
                      {formatFullDate(payment.paidAt.slice(0, 10))}
                      {payment.reference ? ` · ${payment.reference}` : ''}
                    </Text>
                    {payment.note && (
                      <Text variant="caption" numberOfLines={2}>
                        {payment.note}
                      </Text>
                    )}
                  </View>

                  <View className="items-end gap-1">
                    <MoneyText
                      amount={payment.amount}
                      currency={currency}
                      variant="label"
                      className={payment.amount < 0 ? 'text-destructive' : undefined}
                    />
                    {payment.status === 'pending' && <Badge label="Pending" tone="warning" />}
                    {payment.status === 'reversed' && <Badge label="Reversed" tone="danger" />}
                    {payment.isReversal && <Badge label="Reversal" tone="danger" />}
                  </View>
                </View>
              ))}
            </Card>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
