import { useLocalSearchParams, useRouter } from 'expo-router';
import { CheckCircle2, ChevronLeft, HandCoins, RotateCw, UserPlus } from 'lucide-react-native';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/shared/empty-state';
import { MoneyText } from '@/components/shared/money-text';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Text } from '@/components/ui/text';
import { useBrand } from '@/features/groups/brand';
import { useCurrentGroup } from '@/features/groups/current-group';
import { useMembers } from '@/features/members/use-members';
import { usePlan } from '@/features/plans/use-plans';
import { formatFullDate } from '@/features/plans/labels';
import {
  useAppendToRotation,
  useAssignRotation,
  useReversePayout,
  useRotation,
} from '@/features/rotation/use-rotation';
import { ROLE_RANK, type MemberRole } from '@/lib/domain';
import type { CurrencyCode } from '@/lib/money';

export default function RotationScreen() {
  const brand = useBrand();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { membership } = useCurrentGroup();

  const currency = (membership?.currency ?? 'GHS') as CurrencyCode;
  const isAdmin =
    membership !== null && ROLE_RANK[membership.role as MemberRole] >= ROLE_RANK.admin;
  const isTreasurer =
    membership !== null && ROLE_RANK[membership.role as MemberRole] >= ROLE_RANK.treasurer;

  const plan = usePlan(id);
  const rotation = useRotation(id);
  const members = useMembers(membership?.groupId);
  const assignRotation = useAssignRotation();
  const appendToRotation = useAppendToRotation();
  const reversePayout = useReversePayout();

  // Order is built by tapping members in turn — no drag handles to fight with.
  const [draftOrder, setDraftOrder] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const slots = rotation.data ?? [];
  const hasRotation = slots.length > 0;
  const inRotation = new Set(slots.map((s) => s.memberId));
  const notYetInRotation = (members.data ?? []).filter((m) => !inRotation.has(m.id));

  function toggleDraft(memberId: string) {
    setDraftOrder((prev) =>
      prev.includes(memberId) ? prev.filter((id) => id !== memberId) : [...prev, memberId]
    );
  }

  async function handleAssign() {
    setError(null);
    if (draftOrder.length < 2) {
      setError('Pick at least two members, in the order they will collect');
      return;
    }
    try {
      await assignRotation.mutateAsync({ planId: id, memberIds: draftOrder });
      setDraftOrder([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set the rotation order.');
    }
  }

  function confirmReverse(slotId: string, name: string) {
    Alert.alert(
      `Undo ${name}'s payout?`,
      'The expense is voided, the group balance is restored, and their turn becomes available again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Undo it',
          style: 'destructive',
          onPress: () => reversePayout.mutate({ slotId, reason: 'Payout reversed by an admin' }),
        },
      ]
    );
  }

  const paidCount = slots.filter((s) => s.status === 'paid').length;
  const isComplete = hasRotation && paidCount === slots.length;

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
        <Text variant="title" numberOfLines={1} className="flex-1">
          Rotation
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        contentContainerClassName="gap-4 px-5 pt-2"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={rotation.isFetching} onRefresh={() => rotation.refetch()} />
        }>
        {rotation.isPending && (
          <Card>
            <ActivityIndicator />
          </Card>
        )}

        {/* Setting the order for the first time */}
        {!rotation.isPending && !hasRotation && (
          <>
            {isAdmin ? (
              <>
                <Card className="gap-1">
                  <Text variant="heading">Choose who is in the susu</Text>
                  <Text variant="muted">
                    Tap members in the order they will collect. The first person you tap collects
                    first.
                  </Text>
                  <Text variant="muted">
                    Only the members you choose contribute to this susu. Anyone you leave out owes
                    nothing towards it.
                  </Text>
                </Card>

                <View className="gap-2">
                  {(members.data ?? []).map((member) => {
                    const index = draftOrder.indexOf(member.id);
                    const picked = index >= 0;
                    return (
                      <Pressable
                        key={member.id}
                        accessibilityRole="button"
                        accessibilityState={{ selected: picked }}
                        onPress={() => toggleDraft(member.id)}
                        className={`flex-row items-center gap-3 rounded-lg border p-3 ${
                          picked ? 'border-primary bg-primary/10' : 'border-border bg-card'
                        }`}>
                        <View
                          className={`h-8 w-8 items-center justify-center rounded-full ${
                            picked ? 'bg-primary' : 'bg-secondary'
                          }`}>
                          <Text
                            variant="label"
                            className={
                              picked ? 'text-primary-foreground' : 'text-muted-foreground'
                            }>
                            {picked ? index + 1 : '–'}
                          </Text>
                        </View>
                        <Text variant="label" className="flex-1" numberOfLines={1}>
                          {member.fullName}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                {error && (
                  <View className="rounded-lg bg-destructive/10 p-3">
                    <Text variant="caption" className="text-destructive">
                      {error}
                    </Text>
                  </View>
                )}

                <Button
                  label={`Set the order (${draftOrder.length} chosen)`}
                  size="lg"
                  fullWidth
                  loading={assignRotation.isPending}
                  onPress={handleAssign}
                />

                <Text variant="caption" className="text-center">
                  The susu will run for one period per person, then finish. It starts collecting
                  once you set the order, and the order can be redrawn until the first person
                  collects.
                </Text>
              </>
            ) : (
              <EmptyState
                icon={<RotateCw size={28} color="#9AA8A3" />}
                title="No running order yet"
                description="An admin needs to set who collects in which order."
              />
            )}
          </>
        )}

        {/* The rotation itself */}
        {hasRotation && (
          <>
            <Card className="gap-2">
              <View className="flex-row items-center justify-between">
                <Text variant="caption">Turns taken</Text>
                <Text variant="label">
                  {paidCount} of {slots.length}
                </Text>
              </View>
              <Progress
                value={(paidCount / slots.length) * 100}
                label="Rotation progress"
                indicatorClassName={isComplete ? 'bg-success' : undefined}
              />
              {isComplete && (
                <Text variant="caption" className="text-success">
                  Everyone has collected. This susu is complete — start a new one to go again.
                </Text>
              )}
            </Card>

            {slots.map((slot) => {
              const isRecipientPaidUp = slot.collectedSoFar >= slot.expectedPot;
              return (
                <Card key={slot.slotId} className="gap-3">
                  <View className="flex-row items-center gap-3">
                    <View
                      className={`h-9 w-9 items-center justify-center rounded-full ${
                        slot.status === 'paid'
                          ? 'bg-success'
                          : slot.status === 'due'
                            ? 'bg-primary'
                            : 'bg-secondary'
                      }`}>
                      <Text
                        variant="label"
                        className={
                          slot.status === 'upcoming'
                            ? 'text-muted-foreground'
                            : 'text-primary-foreground'
                        }>
                        {slot.position}
                      </Text>
                    </View>

                    <Avatar name={slot.memberName} size="sm" />

                    <View className="flex-1">
                      <Text variant="label" numberOfLines={1}>
                        {slot.memberName}
                      </Text>
                      <Text variant="caption" numberOfLines={1}>
                        {slot.cycleLabel ?? 'Turn not yet open'}
                        {slot.dueDate ? ` · due ${formatFullDate(slot.dueDate)}` : ''}
                      </Text>
                    </View>

                    {slot.status === 'paid' && <Badge label="Collected" tone="success" />}
                    {slot.status === 'due' && <Badge label="Their turn" tone="accent" />}
                  </View>

                  {slot.memberStatus !== 'active' && (
                    <Text variant="caption" className="text-warning">
                      This member is no longer active in the group.
                    </Text>
                  )}

                  {slot.status === 'paid' ? (
                    <View className="flex-row items-center justify-between border-t border-border pt-3">
                      <Text variant="caption">Collected</Text>
                      <MoneyText
                        amount={slot.paidOutAmount ?? 0}
                        currency={currency}
                        variant="label"
                        className="text-success"
                      />
                    </View>
                  ) : slot.status === 'due' ? (
                    <View className="gap-2 border-t border-border pt-3">
                      <View className="flex-row items-center justify-between">
                        <Text variant="caption">Pot for this turn</Text>
                        <MoneyText amount={slot.expectedPot} currency={currency} variant="label" />
                      </View>
                      <View className="flex-row items-center justify-between">
                        <Text variant="caption">Collected so far</Text>
                        <MoneyText
                          amount={slot.collectedSoFar}
                          currency={currency}
                          variant="caption"
                          className={isRecipientPaidUp ? 'text-success' : 'text-warning'}
                        />
                      </View>

                      {isTreasurer && (
                        <Button
                          label="Record payout"
                          icon={<HandCoins size={16} color="white" />}
                          fullWidth
                          onPress={() =>
                            router.push({
                              pathname: '/payouts/[slotId]',
                              params: { slotId: slot.slotId, planId: id },
                            })
                          }
                        />
                      )}
                    </View>
                  ) : null}

                  {isAdmin && slot.status === 'paid' && (
                    <Button
                      label="Undo this payout"
                      variant="ghost"
                      size="sm"
                      onPress={() => confirmReverse(slot.slotId, slot.memberName)}
                    />
                  )}
                </Card>
              );
            })}

            {isAdmin && notYetInRotation.length > 0 && !isComplete && (
              <Card className="gap-2">
                <Text variant="label">Add someone to the end</Text>
                <Text variant="caption">
                  They take the last turn, start contributing, and the susu runs one period longer.
                </Text>
                {notYetInRotation.map((member) => (
                  <Button
                    key={member.id}
                    label={member.fullName}
                    variant="outline"
                    size="sm"
                    icon={<UserPlus size={14} color={brand.deep} />}
                    loading={appendToRotation.isPending}
                    onPress={() => appendToRotation.mutate({ planId: id, memberId: member.id })}
                  />
                ))}
              </Card>
            )}

            {plan.data?.status === 'ended' && (
              <View className="flex-row items-center justify-center gap-2">
                <CheckCircle2 size={16} color={brand.hex} />
                <Text variant="caption">This susu has ended.</Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}
