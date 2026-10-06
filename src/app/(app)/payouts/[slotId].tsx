import { useLocalSearchParams } from 'expo-router';
import { X } from 'lucide-react-native';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MoneyInput } from '@/components/shared/money-input';
import { MoneyText } from '@/components/shared/money-text';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { useCurrentGroup } from '@/features/groups/current-group';
import type { RotationSlotRow } from '@/features/rotation/api';
import { useRecordPayout, useRotation, useSlotArrears } from '@/features/rotation/use-rotation';
import type { CurrencyCode, Minor } from '@/lib/money';
import { goBack } from '@/lib/navigation';

export default function PayoutScreen() {
  // planId travels with the link so this screen needs no lookup of its own —
  // the rotation it came from already knows which plan the turn belongs to.
  const { slotId, planId } = useLocalSearchParams<{ slotId: string; planId: string }>();
  const rotation = useRotation(planId);

  if (rotation.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  const slot = rotation.data?.find((s) => s.slotId === slotId);

  if (!slot) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-6">
        <Text variant="heading">Turn not found</Text>
      </View>
    );
  }

  return <PayoutForm key={slot.slotId} slot={slot} planId={planId} />;
}

function PayoutForm({ slot, planId }: { slot: RotationSlotRow; planId: string }) {
  const insets = useSafeAreaInsets();
  const { membership } = useCurrentGroup();
  const recordPayout = useRecordPayout();

  const currency = (membership?.currency ?? 'GHS') as CurrencyCode;
  const arrears = useSlotArrears(planId, slot.memberId);
  const owed = arrears.data ?? 0;

  const [amount, setAmount] = useState<Minor | null>(slot.expectedPot);
  const [settleArrears, setSettleArrears] = useState(true);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  // What physically changes hands, once their own unpaid share is netted off.
  const handedOver = amount === null ? 0 : settleArrears ? Math.max(0, amount - owed) : amount;

  async function handleSubmit() {
    setError(null);
    if (amount === null || amount <= 0) {
      setError('Enter the amount being collected');
      return;
    }

    try {
      await recordPayout.mutateAsync({
        slotId: slot.slotId,
        amount,
        settleArrears: owed > 0 ? settleArrears : false,
        note: note.trim() === '' ? null : note.trim(),
      });
      goBack();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record the payout. Try again.');
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-background">
      <View
        className="flex-row items-center justify-between px-5 pb-3"
        style={{ paddingTop: insets.top + 8 }}>
        <Text variant="title">Record payout</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={() => goBack()}
          className="rounded-full bg-secondary p-2">
          <X size={18} color="#66756F" />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        contentContainerClassName="gap-6 px-5 pt-2"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <Card className="flex-row items-center gap-3">
          <Avatar name={slot.memberName} size="lg" />
          <View className="flex-1">
            <Text variant="heading" numberOfLines={1}>
              {slot.memberName}
            </Text>
            <Text variant="caption">
              Turn {slot.position} · {slot.cycleLabel}
            </Text>
          </View>
        </Card>

        <Card className="gap-2">
          <View className="flex-row items-center justify-between">
            <Text variant="caption">Pot for this turn</Text>
            <MoneyText amount={slot.expectedPot} currency={currency} variant="label" />
          </View>
          <View className="flex-row items-center justify-between">
            <Text variant="caption">Collected so far</Text>
            <MoneyText
              amount={slot.collectedSoFar}
              currency={currency}
              variant="label"
              className={slot.collectedSoFar >= slot.expectedPot ? 'text-success' : 'text-warning'}
            />
          </View>
          {slot.collectedSoFar < slot.expectedPot && (
            <Text variant="caption" className="text-warning">
              Not everyone has paid this period. You can still record what is actually handed over.
            </Text>
          )}
        </Card>

        <MoneyInput
          label="How much are they collecting?"
          currency={currency}
          value={amount}
          onChange={setAmount}
        />

        {owed > 0 && (
          <Card className="gap-2">
            <View className="flex-row items-center justify-between gap-3">
              <View className="flex-1 pr-2">
                <Text variant="label">Settle their own share</Text>
                <Text variant="caption">
                  They still owe <MoneyText amount={owed} currency={currency} variant="caption" />{' '}
                  to this susu.
                </Text>
              </View>
              <Switch value={settleArrears} onValueChange={setSettleArrears} />
            </View>

            <View className="rounded-md bg-secondary/60 p-3">
              <Text variant="caption">
                {settleArrears ? (
                  <>
                    Their share is treated as paid out of the pot, so they physically receive{' '}
                    <MoneyText amount={handedOver} currency={currency} variant="caption" />.
                  </>
                ) : (
                  <>
                    They receive the full amount and still owe{' '}
                    <MoneyText amount={owed} currency={currency} variant="caption" />.
                  </>
                )}
              </Text>
            </View>
          </Card>
        )}

        <Input
          label="Note (optional)"
          value={note}
          onChangeText={setNote}
          placeholder="Handed over at the meeting"
        />

        {error && (
          <View className="rounded-lg bg-destructive/10 p-3">
            <Text variant="caption" className="text-destructive">
              {error}
            </Text>
          </View>
        )}

        <Button
          label="Record payout"
          size="lg"
          fullWidth
          loading={recordPayout.isPending}
          onPress={handleSubmit}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
