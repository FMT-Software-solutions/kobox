import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowDown, ArrowUp, ChevronLeft, Tags as TagsIcon } from 'lucide-react-native';
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
import { usePlan, usePlanSummary } from '@/features/plans/use-plans';
import {
  useClearPlanTagAmount,
  usePlanTagAmounts,
  useSetPlanTagAmount,
  useTags,
} from '@/features/tags/use-tags';
import { ROLE_RANK, type MemberRole } from '@/lib/domain';
import type { CurrencyCode, Minor } from '@/lib/money';

/**
 * What each tag pays on one contribution — "Executives ₵100, everyone else ₵50"
 * as a single set of books rather than two contributions to reconcile.
 *
 * The order of the priced tags is the tie-break: someone carrying two priced
 * tags is billed once, at whichever sits higher. That has to be something the
 * group sets, not something the app guesses.
 */
export default function PlanAmountsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { membership } = useCurrentGroup();

  const plan = usePlan(id);
  const summary = usePlanSummary(id);
  const tags = useTags(membership?.groupId);
  const amounts = usePlanTagAmounts(id);

  const setAmount = useSetPlanTagAmount();
  const clearAmount = useClearPlanTagAmount();

  const currency = (membership?.currency ?? 'GHS') as CurrencyCode;
  const canManage =
    membership !== null && ROLE_RANK[membership.role as MemberRole] >= ROLE_RANK.treasurer;

  const [drafts, setDrafts] = useState<Record<string, Minor | null>>({});
  const [error, setError] = useState<string | null>(null);

  if (plan.isPending || amounts.isPending || tags.isPending) {
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
        <Button label="Go back" variant="outline" onPress={() => router.back()} />
      </View>
    );
  }

  const priced = amounts.data ?? [];
  const pricedIds = new Set(priced.map((a) => a.tagId));
  const unpriced = (tags.data ?? []).filter((t) => !pricedIds.has(t.id));
  const isLive = summary.data?.hasMoney ?? false;

  async function apply(tagId: string, amount: Minor | null, rank?: number) {
    setError(null);
    if (amount === null || amount <= 0) {
      setError('Enter an amount greater than zero');
      return;
    }
    try {
      await setAmount.mutateAsync({ planId: id, tagId, amount, rank });
      setDrafts((prev) => ({ ...prev, [tagId]: null }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that amount.');
    }
  }

  /** Swapping two neighbours' ranks is the whole of "move up" / "move down". */
  async function swap(indexA: number, indexB: number) {
    const a = priced[indexA];
    const b = priced[indexB];
    if (!a || !b) return;
    setError(null);
    try {
      await setAmount.mutateAsync({
        planId: id,
        tagId: a.tagId,
        amount: a.amount,
        rank: indexB + 1,
      });
      await setAmount.mutateAsync({
        planId: id,
        tagId: b.tagId,
        amount: b.amount,
        rank: indexA + 1,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reorder the tags.');
    }
  }

  const isBusy = setAmount.isPending || clearAmount.isPending;

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
          onPress={() => router.back()}
          className="-ml-2 rounded-full p-2 active:bg-secondary">
          <ChevronLeft size={22} color="#66756F" />
        </Pressable>
        <Text variant="title" numberOfLines={1} className="flex-1">
          Amounts by tag
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        contentContainerClassName="gap-4 px-5 pt-2"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <Card className="gap-1">
          <Text variant="caption">Everyone without a priced tag pays</Text>
          {data.defaultAmount === null ? (
            <Text variant="title">Any amount</Text>
          ) : (
            <MoneyText amount={data.defaultAmount} currency={currency} variant="display" />
          )}
          <Text variant="caption">{data.name}</Text>
        </Card>

        {isLive && (
          <View className="rounded-lg bg-secondary/60 p-3">
            <Text variant="caption">
              Money has been paid into this contribution, so a change here applies to periods that
              open from now on. Periods already issued keep the amount members were told.
            </Text>
          </View>
        )}

        {(tags.data ?? []).length === 0 && (
          <EmptyState
            icon={<TagsIcon size={28} color="#9AA8A3" />}
            title="No tags yet"
            description="Create a tag such as Executives under More → Tags, then set what they pay here."
          />
        )}

        {priced.length > 0 && (
          <View className="gap-2">
            <Text variant="label">Priced tags</Text>
            {priced.length > 1 && (
              <Text variant="caption">
                Someone carrying two of these is billed once, at the higher one. Use the arrows to
                decide which that is.
              </Text>
            )}

            {priced.map((row, index) => (
              <Card key={row.tagId} className="gap-3">
                <View className="flex-row items-center gap-3">
                  <View
                    className="h-8 w-8 rounded-full"
                    style={{ backgroundColor: row.tagColour }}
                  />
                  <View className="flex-1">
                    <Text variant="label" numberOfLines={1}>
                      {row.tagName}
                    </Text>
                    <Text variant="caption">
                      {row.memberCount} {row.memberCount === 1 ? 'member' : 'members'} · pays{' '}
                      <MoneyText amount={row.amount} currency={currency} variant="caption" />
                    </Text>
                  </View>

                  {canManage && priced.length > 1 && (
                    <View className="flex-row gap-1">
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Move ${row.tagName} up`}
                        disabled={index === 0 || isBusy}
                        onPress={() => swap(index, index - 1)}
                        className={`rounded-md p-2 ${index === 0 ? 'opacity-30' : 'active:bg-secondary'}`}>
                        <ArrowUp size={16} color="#66756F" />
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Move ${row.tagName} down`}
                        disabled={index === priced.length - 1 || isBusy}
                        onPress={() => swap(index, index + 1)}
                        className={`rounded-md p-2 ${
                          index === priced.length - 1 ? 'opacity-30' : 'active:bg-secondary'
                        }`}>
                        <ArrowDown size={16} color="#66756F" />
                      </Pressable>
                    </View>
                  )}
                </View>

                {canManage && (
                  <View className="gap-2 border-t border-border pt-3">
                    <MoneyInput
                      label="Change what they pay"
                      currency={currency}
                      value={drafts[row.tagId] ?? row.amount}
                      onChange={(value) => setDrafts((prev) => ({ ...prev, [row.tagId]: value }))}
                    />
                    <View className="flex-row gap-2">
                      <Button
                        label="Save"
                        size="sm"
                        className="flex-1"
                        loading={isBusy}
                        onPress={() => apply(row.tagId, drafts[row.tagId] ?? row.amount, row.rank)}
                      />
                      <Button
                        label="Use the default"
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        loading={isBusy}
                        onPress={() => clearAmount.mutate({ planId: id, tagId: row.tagId })}
                      />
                    </View>
                  </View>
                )}
              </Card>
            ))}
          </View>
        )}

        {canManage && unpriced.length > 0 && (
          <View className="gap-2">
            <Text variant="label">Other tags</Text>
            <Text variant="caption">
              These pay the default. Set an amount to charge them something else.
            </Text>

            {unpriced.map((tag) => (
              <Card key={tag.id} className="gap-3">
                <View className="flex-row items-center gap-3">
                  <View className="h-8 w-8 rounded-full" style={{ backgroundColor: tag.colour }} />
                  <View className="flex-1">
                    <Text variant="label" numberOfLines={1}>
                      {tag.name}
                    </Text>
                    <Text variant="caption">
                      {tag.memberCount} {tag.memberCount === 1 ? 'member' : 'members'} · on the
                      default
                    </Text>
                  </View>
                </View>

                <View className="gap-2 border-t border-border pt-3">
                  <MoneyInput
                    label="What should they pay?"
                    currency={currency}
                    value={drafts[tag.id] ?? null}
                    onChange={(value) => setDrafts((prev) => ({ ...prev, [tag.id]: value }))}
                  />
                  <Button
                    label={`Charge ${tag.name} this amount`}
                    size="sm"
                    fullWidth
                    loading={isBusy}
                    onPress={() => apply(tag.id, drafts[tag.id] ?? null, priced.length + 1)}
                  />
                </View>
              </Card>
            ))}
          </View>
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
