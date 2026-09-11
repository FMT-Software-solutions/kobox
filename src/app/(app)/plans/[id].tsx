import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ChevronLeft,
  ChevronRight,
  Pencil,
  RotateCw,
  Tags as TagsIcon,
  UserCog,
} from 'lucide-react-native';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MoneyText } from '@/components/shared/money-text';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { useBrand } from '@/features/groups/brand';
import { useCurrentGroup } from '@/features/groups/current-group';
import { usePlanOverrides } from '@/features/plans/use-overrides';
import { usePlan, usePlanSummary } from '@/features/plans/use-plans';
import { FREQUENCY_LABEL, KIND_LABEL, formatPeriodLabel } from '@/features/plans/labels';
import { PlanLifecycleActions } from '@/features/plans/plan-lifecycle-actions';
import { useRotation } from '@/features/rotation/use-rotation';
import { usePlanTagAmounts, useTags } from '@/features/tags/use-tags';
import { ROLE_RANK, type MemberRole } from '@/lib/domain';
import { formatMoney, type CurrencyCode } from '@/lib/money';

export default function PlanDetailScreen() {
  const brand = useBrand();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { membership } = useCurrentGroup();

  const plan = usePlan(id);
  const summary = usePlanSummary(id);
  // Only a susu has one, and passing undefined keeps the query switched off.
  const rotation = useRotation(plan.data?.kind === 'rotating' ? id : undefined);
  const tags = useTags(membership?.groupId);
  const tagAmounts = usePlanTagAmounts(id);
  const overrides = usePlanOverrides(id);

  const currency = (membership?.currency ?? 'GHS') as CurrencyCode;
  // Pricing a contribution is bookkeeping; a treasurer sets it up and edits it.
  const canManage =
    membership !== null && ROLE_RANK[membership.role as MemberRole] >= ROLE_RANK.treasurer;

  if (plan.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  if (plan.isError || !plan.data) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-background px-6">
        <Text variant="heading">Contribution not found</Text>
        <Button label="Go back" variant="outline" onPress={() => router.back()} />
      </View>
    );
  }

  const data = plan.data;
  const hasRotation = (rotation.data ?? []).length > 0;
  const isRecurring = data.frequency !== 'once';
  const audienceTag = (tags.data ?? []).find((t) => t.id === data.audienceTagId) ?? null;
  const periods = summary.data?.cycleCount ?? 0;

  // What one member on the standard amount is expected to have paid by now.
  const expectedPerMember = data.defaultAmount === null ? null : data.defaultAmount * periods;

  /*
   * `total_collected` is everything that came in: money matched to an
   * obligation PLUS money paid ahead and still waiting for a period to settle
   * against (`extra_giving`).
   *
   * Subtracting the whole of it from `total_expected` understates the debt.
   * One member paying ₵500 against ₵400 of dues while another pays nothing
   * would read as "still owing ₵300" — but the group really is owed ₵400, and
   * separately holds ₵100 that is not a payment for anything yet. Netting one
   * against the other hides a debtor behind somebody else's advance.
   *
   * So arrears are measured against SETTLED money only, and money paid ahead
   * gets its own line.
   */
  const totalExpected = summary.data?.totalExpected ?? 0;
  const paidAhead = summary.data?.extraGiving ?? 0;
  const settled = (summary.data?.totalCollected ?? 0) - paidAhead;
  const outstanding = totalExpected - settled;

  return (
    <View className="flex-1 bg-background">
      <View
        className="flex-row items-center justify-between gap-2 px-5 pb-3"
        style={{ paddingTop: insets.top + 8 }}>
        <View className="flex-1 flex-row items-center gap-2">
          <Button
            label=""
            variant="ghost"
            size="sm"
            icon={<ChevronLeft size={22} color="#66756F" />}
            onPress={() => router.back()}
            className="-ml-2"
          />
          <Text variant="title" numberOfLines={1} className="flex-1">
            {data.name}
          </Text>
        </View>

        {canManage && (
          <Button
            label="Edit"
            size="sm"
            variant="secondary"
            icon={<Pencil size={14} color={brand.deep} />}
            onPress={() => router.push({ pathname: '/plans/[id]/edit', params: { id: data.id } })}
          />
        )}
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        contentContainerClassName="gap-4 px-5 pt-2"
        showsVerticalScrollIndicator={false}>
        <Card className="gap-2">
          <View className="flex-row items-center justify-between">
            <Text variant="caption">
              {KIND_LABEL[data.kind]} · {FREQUENCY_LABEL[data.frequency]}
            </Text>
            <Badge
              label={data.status}
              tone={data.status === 'active' ? 'success' : 'neutral'}
              className="capitalize"
            />
          </View>

          <View className="flex-row items-end justify-between">
            <View>
              <Text variant="caption">Amount each {isRecurring ? 'period' : 'member'}</Text>
              {data.defaultAmount === null ? (
                <Text variant="title" className="mt-0.5">
                  Any amount
                </Text>
              ) : (
                <MoneyText
                  amount={data.defaultAmount}
                  currency={currency}
                  variant="title"
                  className="mt-0.5"
                />
              )}
            </View>
            <View className="items-end">
              <Text variant="caption">Started</Text>
              <Text variant="label">{formatPeriodLabel(data.startDate, data.frequency)}</Text>
            </View>
          </View>
        </Card>

        {/* A susu is really about whose turn it is */}
        {data.kind === 'rotating' && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="View the rotation order"
            onPress={() =>
              router.push({ pathname: '/plans/[id]/rotation', params: { id: data.id } })
            }
            className="active:opacity-70">
            <Card className="flex-row items-center gap-3 border-primary/30 bg-primary/5">
              <View className="rounded-md bg-secondary p-2">
                <RotateCw size={18} color={brand.hex} />
              </View>
              <View className="flex-1">
                <Text variant="label">Rotation</Text>
                <Text variant="caption">
                  {hasRotation
                    ? 'Who collects, and when'
                    : 'Not collecting yet — choose who is in the susu'}
                </Text>
              </View>
              <ChevronRight size={18} color="#9AA8A3" />
            </Card>
          </Pressable>
        )}

        {/* Who owes it. Silence here would read as "everyone", so a scoped
            contribution has to say so wherever its totals are shown. */}
        {data.kind !== 'rotating' && audienceTag !== null && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open the ${audienceTag.name} tag`}
            onPress={() => router.push({ pathname: '/tags/[id]', params: { id: audienceTag.id } })}
            className="active:opacity-70">
            <Card className="flex-row items-center gap-3">
              <View
                className="h-8 w-8 rounded-full"
                style={{ backgroundColor: audienceTag.colour }}
              />
              <View className="flex-1">
                <Text variant="label">Only for {audienceTag.name}</Text>
                <Text variant="caption">
                  {audienceTag.memberCount}{' '}
                  {audienceTag.memberCount === 1 ? 'member is' : 'members are'} billed. Everyone
                  else owes nothing.
                </Text>
              </View>
              <ChevronRight size={18} color="#9AA8A3" />
            </Card>
          </Pressable>
        )}

        {/* Tiered amounts. Hidden for a susu, where everyone pays the same, and
            for open giving, which has no set amount at all. */}
        {canManage && data.kind !== 'rotating' && data.kind !== 'open' && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Set amounts by tag"
            onPress={() =>
              router.push({ pathname: '/plans/[id]/amounts', params: { id: data.id } })
            }
            className="active:opacity-70">
            <Card className="flex-row items-center gap-3">
              <View className="rounded-md bg-secondary p-2">
                <TagsIcon size={18} color={brand.hex} />
              </View>
              <View className="flex-1">
                <Text variant="label">Amounts by tag</Text>
                <Text variant="caption">
                  {tagAmounts.data && tagAmounts.data.length > 0
                    ? tagAmounts.data
                        .map((a) => `${a.tagName} ${formatMoney(a.amount, currency)}`)
                        .join(' · ')
                    : 'Everyone pays the same — charge a tag its own amount'}
                </Text>
              </View>
              <ChevronRight size={18} color="#9AA8A3" />
            </Card>
          </Pressable>
        )}

        {/* Per-member exceptions. Same two exclusions as tag amounts, and for
            the same reasons. */}
        {canManage && data.kind !== 'rotating' && data.kind !== 'open' && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Set amounts by member"
            onPress={() =>
              router.push({ pathname: '/plans/[id]/members', params: { id: data.id } })
            }
            className="active:opacity-70">
            <Card className="flex-row items-center gap-3">
              <View className="rounded-md bg-secondary p-2">
                <UserCog size={18} color={brand.hex} />
              </View>
              <View className="flex-1">
                <Text variant="label">Amounts by member</Text>
                <Text variant="caption">
                  {overrides.data && overrides.data.length > 0
                    ? `${overrides.data.length} ${
                        overrides.data.length === 1 ? 'exception' : 'exceptions'
                      }`
                    : 'Charge one person differently, or exempt them'}
                </Text>
              </View>
              <ChevronRight size={18} color="#9AA8A3" />
            </Card>
          </Pressable>
        )}

        {/* Expected of each member — the question a member actually asks */}
        <Card className="gap-1">
          <Text variant="caption">
            {isRecurring
              ? `Expected from each member so far (${periods} ${periods === 1 ? 'period' : 'periods'})`
              : 'Expected from each member'}
          </Text>
          {expectedPerMember === null ? (
            <Text variant="title">Any amount</Text>
          ) : (
            <MoneyText amount={expectedPerMember} currency={currency} variant="display" />
          )}
          {isRecurring && data.defaultAmount !== null && (
            <Text variant="caption">
              {periods} × {''}
              <MoneyText
                amount={data.defaultAmount}
                currency={currency}
                variant="caption"
              /> since {formatPeriodLabel(data.startDate, data.frequency)}
            </Text>
          )}
        </Card>

        {/* Group totals — everyone's money on this contribution added together.
            Hidden from ordinary members: they cannot see who paid what, so a
            group total is a number they have no way to check and no use for.
            Their own position is the card above. */}
        {canManage && (
          <Card className="gap-3">
            <Text variant="heading">Across the whole group</Text>

            {summary.isPending ? (
              <ActivityIndicator className="self-start" />
            ) : (
              <View className="gap-2">
                <View className="flex-row items-center justify-between">
                  <Text variant="caption">Expected so far</Text>
                  <MoneyText amount={totalExpected} currency={currency} variant="label" />
                </View>
                <View className="flex-row items-center justify-between">
                  <Text variant="caption">Paid towards it</Text>
                  <MoneyText
                    amount={settled}
                    currency={currency}
                    variant="label"
                    className="text-success"
                  />
                </View>

                <View className="flex-row items-center justify-between border-t border-border pt-2">
                  <Text variant="label">{outstanding > 0 ? 'Still owing' : 'All settled'}</Text>
                  <MoneyText
                    amount={Math.max(0, outstanding)}
                    currency={currency}
                    variant="label"
                    className={outstanding > 0 ? 'text-warning' : 'text-success'}
                  />
                </View>

                {/* Its own line, never netted off the arrears above. This is
                    money the group is holding, not money anybody owes. */}
                {paidAhead > 0 && (
                  <View className="flex-row items-center justify-between">
                    <Text variant="caption">Paid ahead, waiting for a period</Text>
                    <MoneyText
                      amount={paidAhead}
                      currency={currency}
                      variant="label"
                      className="text-primary"
                    />
                  </View>
                )}
              </View>
            )}
          </Card>
        )}

        {data.graceDays > 0 && (
          <Text variant="caption" className="text-center">
            Members have {data.graceDays} days after the due date before a period counts as late.
          </Text>
        )}

        {canManage && <PlanLifecycleActions plan={data} />}
      </ScrollView>
    </View>
  );
}
