import { useLocalSearchParams, useRouter } from 'expo-router';
import { X } from 'lucide-react-native';
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

import { MoneyInput } from '@/components/shared/money-input';
import { MoneyText } from '@/components/shared/money-text';
import { MonthYearPicker } from '@/components/shared/month-year-picker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { useCurrentGroup } from '@/features/groups/current-group';
import { formatPeriodLabel } from '@/features/plans/labels';
import { PlanLifecycleActions } from '@/features/plans/plan-lifecycle-actions';
import type { PlanRow } from '@/features/plans/api';
import { usePlan, useUpdatePlan } from '@/features/plans/use-plans';
import { describeBackfill, nextPeriodStart, toIsoDate, utcDate } from '@/lib/cycles';
import type { CurrencyCode, Minor } from '@/lib/money';

export default function EditPlanScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const plan = usePlan(id);

  if (plan.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  if (plan.isError || !plan.data) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-6">
        <Text variant="heading">Contribution not found</Text>
      </View>
    );
  }

  // Keyed so switching plans remounts with fresh state rather than carrying the
  // previous plan's values over.
  return <EditPlanForm key={plan.data.id} plan={plan.data} />;
}

/**
 * The form is a separate component so its state can be initialised straight from
 * props. Seeding it with useEffect would render once with empty fields and then
 * again with the real values — visible as a flicker, and flagged by the React
 * Compiler's set-state-in-effect rule.
 */
function EditPlanForm({ plan }: { plan: PlanRow }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { membership } = useCurrentGroup();
  const updatePlan = useUpdatePlan();

  const currency = (membership?.currency ?? 'GHS') as CurrencyCode;

  const [name, setName] = useState(plan.name);
  const [amount, setAmount] = useState<Minor | null>(plan.defaultAmount);
  const [graceDays, setGraceDays] = useState(String(plan.graceDays));
  const [start, setStart] = useState(() => {
    const [year, month] = plan.startDate.split('-').map(Number);
    return { month: (month ?? 1) - 1, year: year! };
  });
  const [error, setError] = useState<string | null>(null);

  const nextStart = utcDate(start.year, start.month);
  const nextStartIso = toIsoDate(nextStart);
  const startMovedEarlier = nextStartIso < plan.startDate;
  const startMovedLater = nextStartIso > plan.startDate;

  const amountChanged = amount !== null && amount !== plan.defaultAmount;

  // When a changed amount first takes effect: the next period not yet issued.
  const [planYear, planMonth, planDay] = plan.startDate.split('-').map(Number);
  const upcoming = nextPeriodStart(plan.frequency, utcDate(planYear!, planMonth! - 1, planDay!));
  const nextPeriodLabel = upcoming ? formatPeriodLabel(toIsoDate(upcoming)) : null;

  async function handleSubmit() {
    setError(null);

    if (name.trim().length === 0) {
      setError('Give this contribution a name');
      return;
    }
    try {
      await updatePlan.mutateAsync({
        planId: plan.id,
        name: name.trim(),
        defaultAmount: plan.kind === 'open' ? undefined : (amount ?? undefined),
        graceDays: Number.parseInt(graceDays, 10) || 0,
        // The database decides whether a later date is safe and says which
        // period blocks it, so send the change either way.
        startDate: startMovedEarlier || startMovedLater ? nextStartIso : undefined,
      });
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the changes. Try again.');
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-background">
      <View
        className="flex-row items-center justify-between px-5 pb-3"
        style={{ paddingTop: insets.top + 8 }}>
        <Text variant="title">Edit contribution</Text>
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
        <Input
          label="What is it called?"
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
        />

        {plan.kind !== 'open' && (
          <View className="gap-2">
            <MoneyInput
              label="How much from each member?"
              currency={currency}
              value={amount}
              onChange={setAmount}
            />

            {amountChanged ? (
              // Spell out the consequence in the group's own figures — "future
              // periods only" is easy to read as "everyone owes the difference".
              <View className="gap-1 rounded-lg bg-secondary/60 p-3">
                <Text variant="caption">
                  Periods already open stay at{' '}
                  <MoneyText
                    amount={plan.defaultAmount ?? 0}
                    currency={currency}
                    variant="caption"
                  />
                  . Nobody is charged the difference.
                </Text>
                {nextPeriodLabel && amount !== null && (
                  <Text variant="caption">
                    From {nextPeriodLabel}, each member pays{' '}
                    <MoneyText amount={amount} currency={currency} variant="caption" />.
                  </Text>
                )}
              </View>
            ) : (
              <Text variant="caption">
                Changing this affects future periods only. What members already owe stays as it was.
              </Text>
            )}
          </View>
        )}

        <View className="gap-2">
          <MonthYearPicker
            label="When did it start?"
            month={start.month}
            year={start.year}
            onChange={setStart}
          />

          <View className="rounded-lg bg-secondary/60 p-3">
            <Text variant="caption">
              {startMovedEarlier
                ? describeBackfill(plan.frequency, nextStart)
                : startMovedLater
                  ? 'Periods before this date will be removed. If any of them already has a payment, the change is refused and the period is named.'
                  : `Currently starts ${formatPeriodLabel(plan.startDate)}.`}
            </Text>
          </View>
        </View>

        <Input
          label="Days of grace after the due date"
          value={graceDays}
          onChangeText={setGraceDays}
          keyboardType="number-pad"
          inputMode="numeric"
        />

        {error && (
          <View className="rounded-lg bg-destructive/10 p-3">
            <Text variant="caption" className="text-destructive">
              {error}
            </Text>
          </View>
        )}

        <Button
          label="Save changes"
          size="lg"
          fullWidth
          loading={updatePlan.isPending}
          onPress={handleSubmit}
        />

        <PlanLifecycleActions plan={plan} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
