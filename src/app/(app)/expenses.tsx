import { useRouter } from 'expo-router';
import { Check, ChevronLeft, Plus, Receipt, X } from 'lucide-react-native';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/shared/empty-state';
import { MoneyText } from '@/components/shared/money-text';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { confirm } from '@/lib/confirm';
import {
  useApproveExpense,
  useExpenses,
  useRejectExpense,
  useVoidExpense,
} from '@/features/expenses/use-expenses';
import { useCurrentGroup } from '@/features/groups/current-group';
import { formatFullDate } from '@/features/plans/labels';
import { ROLE_RANK, type MemberRole } from '@/lib/domain';
import type { CurrencyCode } from '@/lib/money';
import { goBack } from '@/lib/navigation';

export default function ExpensesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { membership } = useCurrentGroup();

  const currency = (membership?.currency ?? 'GHS') as CurrencyCode;
  const canRecord =
    membership !== null && ROLE_RANK[membership.role as MemberRole] >= ROLE_RANK.treasurer;
  const canApprove =
    membership !== null && ROLE_RANK[membership.role as MemberRole] >= ROLE_RANK.admin;

  const expenses = useExpenses(membership?.groupId);
  const approve = useApproveExpense();
  const reject = useRejectExpense();
  const voidExpense = useVoidExpense();

  function confirmReject(expenseId: string) {
    confirm({
      title: 'Reject this expense?',
      message: 'It will not count against the group balance.',
      confirmLabel: 'Reject',
      destructive: true,
    }).then((yes) => {
      if (yes) reject.mutate({ expenseId, reason: 'Rejected by an admin' });
    });
  }

  function confirmVoid(expenseId: string) {
    confirm({
      title: 'Void this expense?',
      message: 'The record stays and is marked voided, and the group balance corrects itself.',
      confirmLabel: 'Void it',
      destructive: true,
    }).then((yes) => {
      if (yes) voidExpense.mutate({ expenseId, reason: 'Voided by an admin' });
    });
  }

  return (
    <View className="flex-1 bg-background">
      <View
        className="flex-row items-center justify-between gap-3 px-5 pb-3"
        style={{ paddingTop: insets.top + 8 }}>
        <View className="flex-1 flex-row items-center gap-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={() => goBack()}
            className="-ml-2 rounded-full p-2 active:bg-secondary">
            <ChevronLeft size={22} color="#66756F" />
          </Pressable>
          <Text variant="title">Expenses</Text>
        </View>

        {canRecord && (
          <Button
            label="Record"
            size="sm"
            icon={<Plus size={16} color="white" />}
            onPress={() => router.push('/expenses/new')}
          />
        )}
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        contentContainerClassName="gap-3 px-5 pt-2"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={expenses.isFetching} onRefresh={() => expenses.refetch()} />
        }>
        {expenses.isPending && (
          <Card>
            <ActivityIndicator />
          </Card>
        )}

        {!expenses.isPending && (expenses.data?.length ?? 0) === 0 && (
          <EmptyState
            icon={<Receipt size={28} color="#9AA8A3" />}
            title="No expenses yet"
            description={
              canRecord
                ? 'Record what the group spends so the balance reflects money going out, not just coming in.'
                : 'Nothing has been spent from the group purse yet.'
            }
            actionLabel={canRecord ? 'Record an expense' : undefined}
            onAction={canRecord ? () => router.push('/expenses/new') : undefined}
          />
        )}

        {expenses.data?.map((expense) => (
          <Card key={expense.id} className="gap-2">
            <View className="flex-row items-start justify-between gap-3">
              <View className="flex-1">
                <Text variant="label" numberOfLines={2}>
                  {expense.title}
                </Text>
                <Text variant="caption" numberOfLines={1}>
                  {expense.category ? `${expense.category} · ` : ''}
                  {formatFullDate(expense.spentAt.slice(0, 10))}
                </Text>
                <Text variant="caption">Recorded by {expense.recordedByName}</Text>
              </View>

              <View className="items-end gap-1">
                <MoneyText
                  amount={expense.amount}
                  currency={currency}
                  variant="label"
                  className={expense.status === 'rejected' ? 'text-muted-foreground' : undefined}
                />
                {expense.status === 'pending' && <Badge label="Awaiting approval" tone="warning" />}
                {expense.status === 'rejected' && <Badge label="Not counted" tone="neutral" />}
              </View>
            </View>

            {!!expense.note && <Text variant="caption">{expense.note}</Text>}

            {!!expense.voidReason && (
              <Text variant="caption" className="text-destructive">
                {expense.voidReason}
              </Text>
            )}

            {canApprove && expense.status === 'pending' && (
              <View className="flex-row gap-2 border-t border-border pt-3">
                <Button
                  label="Approve"
                  size="sm"
                  className="flex-1"
                  icon={<Check size={14} color="white" />}
                  loading={approve.isPending}
                  onPress={() => approve.mutate(expense.id)}
                />
                <Button
                  label="Reject"
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  icon={<X size={14} color="#D14343" />}
                  onPress={() => confirmReject(expense.id)}
                />
              </View>
            )}

            {canApprove && expense.status === 'approved' && (
              <View className="border-t border-border pt-3">
                <Button
                  label="Void this expense"
                  size="sm"
                  variant="ghost"
                  onPress={() => confirmVoid(expense.id)}
                />
              </View>
            )}
          </Card>
        ))}
      </ScrollView>
    </View>
  );
}
