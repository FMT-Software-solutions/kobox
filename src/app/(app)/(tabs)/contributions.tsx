import { useRouter } from 'expo-router';
import { CalendarDays, Coins, HandCoins, Plus, RotateCw, Wallet } from 'lucide-react-native';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/shared/empty-state';
import { MoneyText } from '@/components/shared/money-text';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { useBrand } from '@/features/groups/brand';
import { useCurrentGroup } from '@/features/groups/current-group';
import { FREQUENCY_LABEL, KIND_LABEL, formatPeriodLabel } from '@/features/plans/labels';
import { usePlans } from '@/features/plans/use-plans';
import { ROLE_RANK, type MemberRole, type PlanKind } from '@/lib/domain';
import type { CurrencyCode } from '@/lib/money';

function iconFor(kind: PlanKind, color: string) {
  switch (kind) {
    case 'rotating':
      return <RotateCw size={18} color={color} />;
    case 'levy':
      return <CalendarDays size={18} color={color} />;
    case 'savings':
      return <Coins size={18} color={color} />;
    default:
      return <HandCoins size={18} color={color} />;
  }
}

export default function ContributionsScreen() {
  const brand = useBrand();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { membership } = useCurrentGroup();
  const currency = (membership?.currency ?? 'GHS') as CurrencyCode;

  const plans = usePlans(membership?.groupId);

  // Mirrors the create_plan check in the database. The database is the authority;
  // this only avoids offering an action that would be rejected.
  const canManage =
    membership !== null && ROLE_RANK[membership.role as MemberRole] >= ROLE_RANK.admin;

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: 32 }}
        contentContainerClassName="gap-4 px-5"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={plans.isFetching} onRefresh={() => plans.refetch()} />
        }>
        <View className="flex-row items-start justify-between gap-3">
          <View className="flex-1">
            <Text variant="title">Contributions</Text>
            <Text variant="muted" className="mt-1">
              Everything this group collects
            </Text>
          </View>
          {canManage && (
            <Button
              label="New"
              size="sm"
              icon={<Plus size={16} color="white" />}
              onPress={() => router.push('/plans/new')}
            />
          )}
        </View>

        {plans.isPending && (
          <Card>
            <ActivityIndicator />
          </Card>
        )}

        {!plans.isPending && (plans.data?.length ?? 0) === 0 && (
          <EmptyState
            icon={<Wallet size={28} color="#9AA8A3" />}
            title="No contributions set up"
            description={
              canManage
                ? 'Create your first one — monthly dues, a welfare contribution, a one-off levy, or a susu circle.'
                : 'Your group has not set up any contributions yet.'
            }
            actionLabel={canManage ? 'Create a contribution' : undefined}
            onAction={canManage ? () => router.push('/plans/new') : undefined}
          />
        )}

        {plans.data?.map((plan) => (
          <Pressable
            key={plan.id}
            accessibilityRole="button"
            accessibilityLabel={`View ${plan.name}`}
            // Dynamic segments must be passed as params; a template literal is
            // not assignable to Expo Router's typed route map.
            onPress={() => router.push({ pathname: '/plans/[id]', params: { id: plan.id } })}
            className="active:opacity-70">
            <Card>
              <View className="flex-row items-start gap-3">
                <View className="mt-0.5 rounded-md bg-secondary p-2">
                  {iconFor(plan.kind, brand.hex)}
                </View>

                <View className="flex-1">
                  <Text variant="heading" numberOfLines={2}>
                    {plan.name}
                  </Text>
                  <Text variant="caption" className="mt-0.5">
                    {KIND_LABEL[plan.kind]} · {FREQUENCY_LABEL[plan.frequency]}
                  </Text>
                  <Text variant="caption">Since {formatPeriodLabel(plan.startDate)}</Text>
                </View>

                {plan.status === 'active' && <Badge label="Active" tone="success" />}
              </View>

              <View className="mt-4 flex-row items-end justify-between">
                <View>
                  <Text variant="caption">Amount each</Text>
                  {plan.defaultAmount === null ? (
                    <Text variant="heading" className="mt-0.5">
                      Any amount
                    </Text>
                  ) : (
                    <MoneyText
                      amount={plan.defaultAmount}
                      currency={currency}
                      variant="heading"
                      className="mt-0.5"
                    />
                  )}
                </View>

                {plan.graceDays > 0 && <Text variant="caption">{plan.graceDays} days grace</Text>}
              </View>
            </Card>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
