import { useLocalSearchParams } from 'expo-router';
import { ChevronLeft, UserCog } from 'lucide-react-native';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/shared/empty-state';
import { MoneyInput } from '@/components/shared/money-input';
import { MoneyText } from '@/components/shared/money-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { useCurrentGroup } from '@/features/groups/current-group';
import { useMembers } from '@/features/members/use-members';
import {
  useClearPlanOverride,
  usePlanOverrides,
  useSetPlanOverride,
} from '@/features/plans/use-overrides';
import { usePlan, usePlanSummary } from '@/features/plans/use-plans';
import { ROLE_RANK, type MemberRole } from '@/lib/domain';
import type { CurrencyCode, Minor } from '@/lib/money';
import { goBack } from '@/lib/navigation';

/**
 * What one named member pays on one contribution — the exception the treasurer
 * makes for the student, the retiree, the person having a hard year.
 *
 * This is the most specific step of the pricing chain, and until now the only
 * one with no way in from the app: the table was reachable by direct write,
 * which is also the only path that could re-price an obligation somebody had
 * already paid against. Everything here goes through `set_plan_override`.
 */
export default function PlanMemberAmountsScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { membership } = useCurrentGroup();

  const plan = usePlan(id);
  const summary = usePlanSummary(id);
  const members = useMembers(membership?.groupId);
  const overrides = usePlanOverrides(id);

  const setOverride = useSetPlanOverride();
  const clearOverride = useClearPlanOverride();

  const currency = (membership?.currency ?? 'GHS') as CurrencyCode;
  const canManage =
    membership !== null && ROLE_RANK[membership.role as MemberRole] >= ROLE_RANK.treasurer;

  const [drafts, setDrafts] = useState<Record<string, Minor | null>>({});
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (plan.isPending || overrides.isPending || members.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  const data = plan.data;
  if (!data) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-background px-6">
        <Text variant="heading">Contribution not found</Text>
        <Button label="Go back" variant="outline" onPress={() => goBack()} />
      </View>
    );
  }

  const set = overrides.data ?? [];
  const overriddenIds = new Set(set.map((row) => row.memberId));
  const rest = (members.data ?? []).filter((m) => !overriddenIds.has(m.id));
  const isLive = summary.data?.hasMoney ?? false;
  const isBusy = setOverride.isPending || clearOverride.isPending;

  async function apply(memberId: string, amount: Minor | null) {
    setError(null);
    if (amount !== null && amount < 0) {
      setError('Enter an amount of zero or more.');
      return;
    }
    try {
      await setOverride.mutateAsync({ planId: id, memberId, amount });
      setDrafts((prev) => ({ ...prev, [memberId]: null }));
      setOpenFor(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that amount.');
    }
  }

  async function exempt(memberId: string) {
    setError(null);
    try {
      await setOverride.mutateAsync({ planId: id, memberId, amount: null });
      setOpenFor(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not exempt that member.');
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-background">
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
        <Text variant="title" numberOfLines={1} className="flex-1">
          Amounts by member
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        contentContainerClassName="gap-4 px-5 pt-2"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <Card className="gap-1">
          <Text variant="caption">Everyone without an exception pays</Text>
          {data.defaultAmount === null ? (
            <Text variant="title">Any amount</Text>
          ) : (
            <MoneyText amount={data.defaultAmount} currency={currency} variant="display" />
          )}
          <Text variant="caption">{data.name}</Text>
        </Card>

        <View className="rounded-lg bg-secondary/60 p-3">
          <Text variant="caption">
            An exception here beats a tag price. Leave the amount blank to exempt someone completely
            — their unpaid periods are set aside rather than deleted, so anything they have already
            paid stays on the books.
          </Text>
        </View>

        {isLive && (
          <View className="rounded-lg bg-secondary/60 p-3">
            <Text variant="caption">
              Money has been paid into this contribution, so periods already issued keep the amount
              members were told. A change here applies to periods that open from now on.
            </Text>
          </View>
        )}

        {set.length > 0 && (
          <View className="gap-2">
            <Text variant="label">Exceptions</Text>
            {set.map((row) => (
              <Card key={row.memberId} className="gap-3">
                <View className="flex-1">
                  <Text variant="label" numberOfLines={1}>
                    {row.memberName}
                  </Text>
                  {row.amount === null ? (
                    <Text variant="caption">Exempt — not billed for this contribution</Text>
                  ) : (
                    <Text variant="caption">
                      Pays <MoneyText amount={row.amount} currency={currency} variant="caption" />
                    </Text>
                  )}
                </View>

                {canManage && (
                  <View className="gap-2 border-t border-border pt-3">
                    <MoneyInput
                      label="Change what they pay"
                      currency={currency}
                      value={drafts[row.memberId] ?? row.amount}
                      onChange={(value) =>
                        setDrafts((prev) => ({ ...prev, [row.memberId]: value }))
                      }
                    />
                    <View className="flex-row gap-2">
                      <Button
                        label="Save"
                        size="sm"
                        className="flex-1"
                        loading={isBusy}
                        onPress={() => apply(row.memberId, drafts[row.memberId] ?? row.amount)}
                      />
                      <Button
                        label="Remove exception"
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        loading={isBusy}
                        onPress={() => clearOverride.mutate({ planId: id, memberId: row.memberId })}
                      />
                    </View>
                    {row.amount !== null && (
                      <Button
                        label="Exempt them instead"
                        size="sm"
                        variant="outline"
                        fullWidth
                        loading={isBusy}
                        onPress={() => exempt(row.memberId)}
                      />
                    )}
                  </View>
                )}
              </Card>
            ))}
          </View>
        )}

        {canManage && rest.length > 0 && (
          <View className="gap-2">
            <Text variant="label">Everyone else</Text>
            <Text variant="caption">
              These pay whatever their tag or the default says. Tap someone to make an exception.
            </Text>

            {rest.map((member) => (
              <Card key={member.id} className="gap-3">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Make an exception for ${member.fullName}`}
                  onPress={() => setOpenFor(openFor === member.id ? null : member.id)}>
                  <Text variant="label" numberOfLines={1}>
                    {member.fullName}
                  </Text>
                  <Text variant="caption">On the usual amount</Text>
                </Pressable>

                {openFor === member.id && (
                  <View className="gap-2 border-t border-border pt-3">
                    <MoneyInput
                      label="What should they pay?"
                      currency={currency}
                      value={drafts[member.id] ?? null}
                      onChange={(value) => setDrafts((prev) => ({ ...prev, [member.id]: value }))}
                    />
                    <Button
                      label={`Charge ${member.fullName} this amount`}
                      size="sm"
                      fullWidth
                      loading={isBusy}
                      onPress={() => apply(member.id, drafts[member.id] ?? null)}
                    />
                    <Button
                      label="Exempt them from this contribution"
                      size="sm"
                      variant="outline"
                      fullWidth
                      loading={isBusy}
                      onPress={() => exempt(member.id)}
                    />
                  </View>
                )}
              </Card>
            ))}
          </View>
        )}

        {(members.data ?? []).length === 0 && (
          <EmptyState
            icon={<UserCog size={28} color="#9AA8A3" />}
            title="No members yet"
            description="Add members to the group first, then set what any of them pays here."
          />
        )}

        {error && (
          <View className="rounded-lg bg-destructive/10 p-3">
            <Text variant="caption" className="text-destructive">
              {error}
            </Text>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
