import { useRouter } from 'expo-router';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  Inbox,
  Plus,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/shared/empty-state';
import { MoneyText } from '@/components/shared/money-text';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Text } from '@/components/ui/text';
import {
  useGroupSummary,
  useMyStanding,
  useRecentPayments,
} from '@/features/dashboard/use-dashboard';
import { useBrand } from '@/features/groups/brand';
import { useCurrentGroup } from '@/features/groups/current-group';
import { useJoinRequests } from '@/features/groups/use-membership';
import { useConfirmPayment } from '@/features/payments/use-payments';
import { formatFullDate } from '@/features/plans/labels';
import { usePlans } from '@/features/plans/use-plans';
import { useMyProfile } from '@/features/profile/use-profile';
import { describeCoverage } from '@/lib/cycles';
import { ROLE_RANK, type MemberRole } from '@/lib/domain';
import type { CurrencyCode } from '@/lib/money';

export default function HomeScreen() {
  const brand = useBrand();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { membership, memberships, selectGroup } = useCurrentGroup();
  const [switching, setSwitching] = useState(false);
  const confirmPayment = useConfirmPayment();

  const isTreasurer =
    membership !== null && ROLE_RANK[membership.role as MemberRole] >= ROLE_RANK.treasurer;
  const canManageMembers =
    membership !== null && ROLE_RANK[membership.role as MemberRole] >= ROLE_RANK.treasurer;
  // Approving a join request is admin-only, so only an admin is shown the
  // prompt — telling a treasurer about work they cannot do is just noise.
  const isAdmin =
    membership !== null && ROLE_RANK[membership.role as MemberRole] >= ROLE_RANK.admin;

  const groupId = membership?.groupId;
  const currency = (membership?.currency ?? 'GHS') as CurrencyCode;

  const summary = useGroupSummary(groupId);
  // A member fetches only their own rows — scoping the query, not the view.
  const payments = useRecentPayments(groupId, isTreasurer ? undefined : membership?.memberId);
  const standing = useMyStanding(membership?.memberId);
  const plans = usePlans(groupId);
  const profile = useMyProfile();
  const joinRequests = useJoinRequests(groupId, isAdmin);

  const isRefreshing = summary.isFetching || payments.isFetching || standing.isFetching;

  const refresh = useCallback(() => {
    summary.refetch();
    payments.refetch();
    standing.refetch();
    // Pulling down is how an admin checks for anything new, and a waiting
    // person is the most time-sensitive thing on this screen.
    joinRequests.refetch();
  }, [summary, payments, standing, joinRequests]);

  if (!membership) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  const pendingCount = joinRequests.data?.length ?? 0;

  const owes = standing.data?.balance ?? 0;
  const isSettled = owes <= 0;
  const hasObligations = (standing.data?.totalDue ?? 0) > 0;

  // Coverage is described against the group's main recurring plan — the one a
  // member means when they ask "how many months am I paid up for?".
  // Any active plan will do — a one-off levy is just as payable as monthly dues.
  const hasContributions = (plans.data ?? []).some((p) => p.status === 'active');

  const recurringPlan = plans.data?.find((p) => p.status === 'active' && p.frequency !== 'once');
  const coverage = recurringPlan
    ? describeCoverage(
        standing.data?.credit ?? 0,
        recurringPlan.defaultAmount,
        recurringPlan.frequency
      )
    : null;

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: 32 }}
        contentContainerClassName="gap-5 px-5"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refresh} />}>
        <View className="flex-row items-center justify-between">
          {/* The group name is where people expect to switch group — buried in
              More, nobody found it. Always tappable, even with one group:
              joining or starting another is reached from here too, and that had
              no way in at all once somebody already belonged somewhere. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Switch or add a group"
            onPress={() => setSwitching((open) => !open)}
            className="flex-1 pr-3 active:opacity-70">
            <Text variant="caption">Your group</Text>
            <View className="flex-row items-center gap-1">
              <Text variant="title" numberOfLines={1} className="shrink">
                {membership.groupName}
              </Text>
              <ChevronDown size={18} color="#66756F" />
            </View>
          </Pressable>
          {/* This showed the group's initials and did nothing when tapped,
              which reads as broken. It is your own picture now, and it opens
              your profile — the one thing an avatar in a corner should do. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open your profile"
            onPress={() => router.push('/profile')}
            className="active:opacity-70">
            <Avatar
              name={profile.data?.fullName?.trim() || 'You'}
              uri={profile.data?.avatarUrl}
              size="lg"
            />
          </Pressable>
        </View>

        {switching && (
          <Card className="gap-0 p-0">
            {memberships.map((item, index) => {
              const isCurrent = item.groupId === membership.groupId;
              return (
                <Pressable
                  key={item.groupId}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isCurrent }}
                  accessibilityLabel={`Switch to ${item.groupName}`}
                  onPress={() => {
                    selectGroup(item.groupId);
                    setSwitching(false);
                  }}
                  className={`flex-row items-center gap-3 p-4 active:bg-secondary ${
                    index > 0 ? 'border-t border-border' : ''
                  }`}>
                  <Avatar name={item.groupName} size="sm" />
                  <View className="flex-1">
                    <Text variant="label" numberOfLines={1}>
                      {item.groupName}
                    </Text>
                    <Text variant="caption" className="capitalize">
                      {item.role}
                    </Text>
                  </View>
                  {isCurrent && <Check size={18} color={brand.hex} />}
                </Pressable>
              );
            })}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Join or create another group"
              onPress={() => {
                setSwitching(false);
                router.push('/onboarding');
              }}
              className="flex-row items-center gap-3 border-t border-border p-4 active:bg-secondary">
              <View className="h-8 w-8 items-center justify-center rounded-full bg-secondary">
                <Plus size={16} color={brand.hex} />
              </View>
              <Text variant="label" className="flex-1 text-primary">
                Join or create another group
              </Text>
            </Pressable>
          </Card>
        )}

        {/* Somebody is waiting on a person, not on the app. Nothing surfaced
            this before — a request sat unseen on the members screen until an
            admin happened to open it, which for a group that vets its members
            is the difference between joining today and joining next month. */}
        {isAdmin && pendingCount > 0 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Review ${pendingCount} join ${
              pendingCount === 1 ? 'request' : 'requests'
            }`}
            onPress={() => router.push('/members')}
            className="active:opacity-70">
            <Card className="flex-row items-center gap-3 border-primary/30 bg-primary/5">
              <View className="rounded-md bg-secondary p-2">
                <UserCheck size={18} color={brand.hex} />
              </View>
              <View className="flex-1">
                <Text variant="label">
                  {pendingCount === 1
                    ? '1 person wants to join'
                    : `${pendingCount} people want to join`}
                </Text>
                <Text variant="caption">Approve or decline</Text>
              </View>
              <ChevronRight size={18} color={brand.deep} />
            </Card>
          </Pressable>
        )}

        {/* What this member owes right now */}
        {hasObligations ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="See a breakdown of what you owe and what you have paid"
            onPress={() => router.push('/statement')}
            className="active:opacity-70">
            <Card
              className={
                isSettled ? 'border-success/30 bg-success/10' : 'border-warning/40 bg-warning/10'
              }>
              {isSettled ? (
                <Text variant="title" className="text-success">
                  You&rsquo;re all paid up
                </Text>
              ) : (
                <View className="flex-row items-baseline gap-2">
                  <Text variant="title">You owe</Text>
                  <MoneyText
                    amount={owes}
                    currency={currency}
                    variant="title"
                    className="text-warning"
                  />
                </View>
              )}

              <View className="mt-4">
                <Progress
                  value={
                    ((standing.data?.totalPaid ?? 0) / Math.max(1, standing.data?.totalDue ?? 1)) *
                    100
                  }
                  label="Your contribution progress"
                  indicatorClassName={isSettled ? 'bg-success' : 'bg-warning'}
                />
              </View>

              <View className="mt-3 flex-row items-center gap-1">
                <Text variant="caption" className="text-primary">
                  See the breakdown
                </Text>
                <ChevronRight size={14} color={brand.deep} />
              </View>
            </Card>
          </Pressable>
        ) : (
          <Card className="bg-secondary/40">
            <Text variant="heading">Nothing due yet</Text>
            <Text variant="muted" className="mt-1">
              Once your group sets up dues or a contribution, what you owe shows up here.
            </Text>
          </Card>
        )}

        {/* Money paid ahead, waiting for future periods to claim it */}
        {(standing.data?.credit ?? 0) > 0 && (
          <Card className="flex-row items-center justify-between border-primary/30 bg-primary/5">
            <View className="flex-1 pr-3">
              <Text variant="label">Paid in advance</Text>
              <Text variant="caption">
                {coverage ?? 'Applied automatically as new periods open'}
              </Text>
            </View>
            <MoneyText
              amount={standing.data?.credit ?? 0}
              currency={currency}
              variant="heading"
              className="text-primary"
            />
          </Card>
        )}

        {/* A payment has to land against something. With no contribution there
            are no obligations to settle, so every amount entered would become
            unallocated credit against a plan that may never exist — money the
            treasurer then has to explain. Better to say so than to take it. */}
        {/* Recording money is a treasurer's job. A member seeing this button
            could only ever record their own payment as pending, which reads as
            "I have paid" and then quietly is not true until somebody confirms
            it — so the group's money gets entered by the people answerable for
            it, and nobody else. */}
        {isTreasurer && (
          <View className="gap-2">
            <Button
              label="Record a payment"
              size="lg"
              fullWidth
              icon={<Plus color="white" size={20} />}
              disabled={!hasContributions}
              onPress={() => router.push('/payments/new')}
            />
            {!hasContributions && (
              <Text variant="caption" className="text-center">
                Set up a contribution first — there is nothing to record a payment against yet.
              </Text>
            )}
            {!hasContributions && canManageMembers && (
              <Button
                label="Create a contribution"
                variant="outline"
                fullWidth
                onPress={() => router.push('/plans/new')}
              />
            )}
          </View>
        )}

        {/* Group money — the whole group's position, which is the treasurer's
            and the auditor's business. A member's own standing is the card
            above and their statement; the group's books are not theirs to
            read at a glance. */}
        {isTreasurer && (
          <View>
            <Text variant="heading" className="mb-3">
              Group at a glance
            </Text>

            <Card>
              <Text variant="caption">Money the group has</Text>
              {summary.isPending ? (
                <ActivityIndicator className="mt-2 self-start" />
              ) : (
                <MoneyText
                  amount={summary.data?.cashOnHand ?? 0}
                  currency={currency}
                  variant="display"
                  className="mt-1"
                />
              )}

              <View className="mt-4 flex-row gap-3">
                <View className="flex-1 rounded-md bg-secondary p-3">
                  <View className="flex-row items-center gap-1.5">
                    <ArrowDownLeft size={14} color={brand.hex} />
                    <Text variant="caption">Collected</Text>
                  </View>
                  <MoneyText
                    amount={summary.data?.totalCollected ?? 0}
                    currency={currency}
                    variant="label"
                    className="mt-1"
                  />
                </View>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="View expenses"
                  onPress={() => router.push('/expenses')}
                  className="flex-1 rounded-md bg-secondary p-3 active:opacity-70">
                  <View className="flex-row items-center gap-1.5">
                    <ArrowUpRight size={14} color="#D14343" />
                    <Text variant="caption">Spent</Text>
                  </View>
                  <MoneyText
                    amount={summary.data?.totalExpenses ?? 0}
                    currency={currency}
                    variant="label"
                    className="mt-1"
                  />
                </Pressable>
              </View>

              {/* Recorded but not yet approved — not deducted from the balance. */}
              {(summary.data?.pendingExpenses ?? 0) > 0 && (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push('/expenses')}
                  className="mt-3 flex-row items-center justify-between rounded-md bg-warning/10 p-3 active:opacity-70">
                  <Text variant="caption">Expenses awaiting approval</Text>
                  <MoneyText
                    amount={summary.data?.pendingExpenses ?? 0}
                    currency={currency}
                    variant="label"
                    className="text-warning"
                  />
                </Pressable>
              )}
            </Card>
          </View>
        )}

        <Card className="flex-row items-center justify-between">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="View members"
            onPress={() => router.push('/members')}
            className="flex-1">
            <View className="flex-row items-center gap-1.5">
              <Users size={14} color={brand.hex} />
              <Text variant="caption">Members</Text>
            </View>
            <Text variant="title" className="mt-1">
              {summary.data?.activeMembers ?? 1}
            </Text>
          </Pressable>

          {canManageMembers && (
            <Button
              label="Add"
              size="sm"
              variant="secondary"
              icon={<UserPlus size={16} color={brand.deep} />}
              onPress={() => router.push('/members/new')}
            />
          )}
        </Card>

        {/* Recent activity. A treasurer sees the whole group's ledger; a member
            sees only their own — the query is scoped, not just the heading, so
            nobody else's payments are fetched at all.
            Hiding it entirely from members left the screen half empty and took
            away the thing they most want at a glance: did my payment land. */}
        <View>
          <Text variant="heading" className="mb-3">
            {isTreasurer ? 'Recent payments' : 'Your recent payments'}
          </Text>

          {payments.isPending ? (
            <Card>
              <ActivityIndicator />
            </Card>
          ) : (payments.data?.length ?? 0) === 0 ? (
            <EmptyState
              icon={<Inbox size={28} color="#9AA8A3" />}
              title={isTreasurer ? 'No payments yet' : 'No payments yet'}
              description={
                isTreasurer
                  ? 'When you record the first contribution, it appears here for everyone to see.'
                  : 'Once your treasurer records a payment from you, it shows up here.'
              }
            />
          ) : (
            <Card className="gap-0 p-0">
              {payments.data!.map((payment, index) => (
                <View
                  key={payment.id}
                  className={`flex-row items-center gap-3 p-4 ${
                    index > 0 ? 'border-t border-border' : ''
                  }`}>
                  {/* Every row is this member's own, so their name on all of
                        them would be noise. The date is the useful line. */}
                  {isTreasurer && <Avatar name={payment.memberName} />}
                  <View className="flex-1">
                    <Text variant="label" numberOfLines={1}>
                      {isTreasurer
                        ? payment.memberName
                        : formatFullDate(payment.paidAt.slice(0, 10))}
                    </Text>
                    <Text variant="caption" numberOfLines={1}>
                      <Text variant="caption" className="capitalize">
                        {payment.method}
                      </Text>
                      {payment.planName ? ` · ${payment.planName}` : ''}
                      {payment.reference ? ` · ${payment.reference}` : ''}
                    </Text>
                  </View>
                  <View className="items-end gap-1">
                    <MoneyText amount={payment.amount} currency={currency} variant="label" />
                    {payment.status === 'reversed' && <Badge label="Reversed" tone="danger" />}
                    {payment.status === 'pending' &&
                      (isTreasurer ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Confirm payment from ${payment.memberName}`}
                          disabled={confirmPayment.isPending}
                          onPress={() => confirmPayment.mutate(payment.id)}
                          className="flex-row items-center gap-1 rounded-full bg-primary px-2.5 py-1 active:opacity-80">
                          <Check size={12} color="white" />
                          <Text variant="caption" className="font-semibold text-primary-foreground">
                            Confirm
                          </Text>
                        </Pressable>
                      ) : (
                        <Badge label="Pending" tone="warning" />
                      ))}
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
