import { useRouter } from 'expo-router';
import { X } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MoneyInput } from '@/components/shared/money-input';
import { MoneyText } from '@/components/shared/money-text';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { OptionGroup, type Option } from '@/components/ui/option-group';
import { Select } from '@/components/ui/select';
import { Text } from '@/components/ui/text';
import { useCurrentGroup } from '@/features/groups/current-group';
import { useMembers } from '@/features/members/use-members';
import { useOutstanding, useRecordPayment } from '@/features/payments/use-payments';
import { usePlans } from '@/features/plans/use-plans';
import { ROLE_RANK, type MemberRole, type PaymentMethod } from '@/lib/domain';
import { formatMoney, type CurrencyCode, type Minor } from '@/lib/money';

/** Sentinel for "not earmarked" — OptionGroup values must be strings. */
const GENERAL = '__general__';

const METHOD_OPTIONS: readonly Option<PaymentMethod>[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'momo', label: 'Mobile money' },
  { value: 'bank', label: 'Bank' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'other', label: 'Other' },
];

export default function NewPaymentScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { membership } = useCurrentGroup();
  const recordPayment = useRecordPayment();

  const currency = (membership?.currency ?? 'GHS') as CurrencyCode;
  const isTreasurer =
    membership !== null && ROLE_RANK[membership.role as MemberRole] >= ROLE_RANK.treasurer;

  const members = useMembers(membership?.groupId);

  // Members may only record for themselves; treasurers pick anyone.
  const [memberId, setMemberId] = useState<string | null>(membership?.memberId ?? null);
  const selectedMemberId = isTreasurer ? memberId : (membership?.memberId ?? null);

  const [amount, setAmount] = useState<Minor | null>(null);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  /**
   * `null` means nothing has been chosen yet — deliberately not defaulted.
   * Most payments are handed over for a named contribution, so guessing
   * "anything owed" would quietly spread money across plans the treasurer never
   * intended to touch.
   */
  const [selection, setSelection] = useState<string | null>(null);
  const designatedPlanId = selection === GENERAL ? null : selection;

  const plans = usePlans(membership?.groupId);
  const outstanding = useOutstanding(membership?.groupId, selectedMemberId ?? undefined);

  const designatedPlan = plans.data?.find((p) => p.id === designatedPlanId) ?? null;

  const planOptions: readonly Option<string>[] = [
    ...(plans.data ?? [])
      .filter((p) => p.status === 'active')
      .map((p) => ({
        value: p.id,
        label: p.name,
        hint: p.kind === 'open' ? 'Any amount' : undefined,
      })),
    // Last, because it is the exception rather than the usual case.
    { value: GENERAL, label: 'Anything owed', hint: 'Oldest first, any contribution' },
  ];

  /**
   * Mirrors allocate_payment: oldest obligation first. Shown before submitting so
   * the treasurer can see exactly what the money will clear rather than
   * discovering it afterwards.
   */
  const preview = useMemo(() => {
    if (selection === null || amount === null || amount <= 0 || !outstanding.data) return [];

    let remaining = amount;
    const rows: { label: string; applied: Minor }[] = [];

    // A designated payment only settles that plan's obligations.
    const settleable =
      designatedPlanId === null
        ? outstanding.data
        : outstanding.data.filter((item) => item.planId === designatedPlanId);

    for (const item of settleable) {
      if (remaining <= 0) break;
      const applied = Math.min(remaining, item.balance);
      rows.push({ label: `${item.planName} · ${item.cycleLabel}`, applied });
      remaining -= applied;
    }

    if (remaining > 0) {
      let label: string;
      if (designatedPlan === null) {
        label = 'Held as credit for future periods';
      } else if (designatedPlan.kind === 'open') {
        // Open giving has no fixed amount, so nothing here is "extra" — the
        // whole payment simply goes to the appeal.
        label = `Goes to ${designatedPlan.name}`;
      } else if (rows.length > 0) {
        label = `Extra giving to ${designatedPlan.name}`;
      } else {
        label = `Given to ${designatedPlan.name}`;
      }

      rows.push({ label, applied: remaining });
    }

    return rows;
  }, [selection, amount, outstanding.data, designatedPlanId, designatedPlan]);

  // "Will clear" is only honest when something is actually being settled.
  const settlesSomething =
    designatedPlanId === null
      ? true
      : (outstanding.data ?? []).some((item) => item.planId === designatedPlanId);

  const selectedMember = members.data?.find((m) => m.id === selectedMemberId);

  // What they owe rides along as the hint, so a treasurer picking a name can
  // see the arrears they are about to settle without leaving the sheet.
  const memberOptions = (members.data ?? []).map((member) => ({
    value: member.id,
    label: member.fullName,
    hint: member.balance > 0 ? `Owes ${formatMoney(member.balance, currency)}` : undefined,
  }));

  async function handleSubmit() {
    setError(null);

    if (!membership) return;
    if (selectedMemberId === null) {
      setError('Choose who this payment is from');
      return;
    }
    if (selection === null) {
      setError('Choose what this payment is for');
      return;
    }
    if (amount === null || amount <= 0) {
      setError('Enter an amount greater than zero');
      return;
    }

    try {
      await recordPayment.mutateAsync({
        groupId: membership.groupId,
        memberId: selectedMemberId,
        amount,
        method,
        reference: reference.trim() === '' ? null : reference.trim(),
        note: note.trim() === '' ? null : note.trim(),
        designatedPlanId,
      });
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record the payment. Try again.');
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-background">
      <View
        className="flex-row items-center justify-between px-5 pb-3"
        style={{ paddingTop: insets.top + 8 }}>
        <Text variant="title">Record a payment</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={() => router.back()}
          className="rounded-full bg-secondary p-2">
          <X size={18} color="#66756F" />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        contentContainerClassName="gap-6 px-5 pt-2"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        {/* Collapsed, not a list. Rendering every member inline pushed the
            amount field below a screen and a half of names in any group of a
            realistic size, so recording a payment began with a long scroll. */}
        {isTreasurer ? (
          <Select
            label="Who paid?"
            placeholder="Choose a member"
            options={memberOptions}
            value={selectedMemberId ?? null}
            onChange={setMemberId}
          />
        ) : (
          <Card className="flex-row items-center gap-3">
            <Avatar name={selectedMember?.fullName ?? 'You'} />
            <View className="flex-1">
              <Text variant="label">{selectedMember?.fullName ?? 'Your payment'}</Text>
              <Text variant="caption">A treasurer will confirm it</Text>
            </View>
          </Card>
        )}

        <View className="gap-1.5">
          <Select
            label="What is this payment for?"
            placeholder="Choose a contribution"
            options={planOptions}
            value={selection}
            onChange={setSelection}
          />
          {selection === null ? (
            <Text variant="caption">Choose the contribution this money is for.</Text>
          ) : (
            ''
          )}
        </View>

        <MoneyInput
          label="How much?"
          currency={currency}
          value={amount}
          onChange={setAmount}
          autoFocus={!isTreasurer}
        />

        <OptionGroup
          label="How was it paid?"
          options={METHOD_OPTIONS}
          value={method}
          onChange={setMethod}
        />

        {method !== 'cash' && (
          <Input
            label="Reference (optional)"
            value={reference}
            onChangeText={setReference}
            placeholder="MTN-88213"
            autoCapitalize="characters"
            autoCorrect={false}
          />
        )}

        <Input
          label="Note (optional)"
          value={note}
          onChangeText={setNote}
          placeholder="Paid at the Sunday meeting"
        />

        {/* What this money will settle */}
        {preview.length > 0 && (
          <Card className="gap-2">
            <Text variant="label">
              {settlesSomething ? 'This payment will clear' : 'Where this payment goes'}
            </Text>
            {preview.map((row, index) => (
              <View key={index} className="flex-row items-center justify-between gap-3">
                <Text variant="caption" className="flex-1" numberOfLines={1}>
                  {row.label}
                </Text>
                <MoneyText amount={row.applied} currency={currency} variant="caption" />
              </View>
            ))}
          </Card>
        )}

        {selection !== null &&
          amount !== null &&
          amount > 0 &&
          preview.length === 0 &&
          !outstanding.isPending && (
            <Card className="bg-secondary/40">
              <Text variant="caption">
                Nothing is currently owed, so this will be held as credit against future periods.
              </Text>
            </Card>
          )}

        {error && (
          <View className="rounded-lg bg-destructive/10 p-3">
            <Text variant="caption" className="text-destructive">
              {error}
            </Text>
          </View>
        )}

        <Button
          label={isTreasurer ? 'Record payment' : 'Submit for confirmation'}
          size="lg"
          fullWidth
          loading={recordPayment.isPending}
          onPress={handleSubmit}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
