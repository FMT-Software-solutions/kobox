import { useRouter } from 'expo-router';
import { X } from 'lucide-react-native';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DateField } from '@/components/shared/date-field';
import { MoneyInput } from '@/components/shared/money-input';
import { MONTHS, MonthYearPicker } from '@/components/shared/month-year-picker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { OptionGroup, type Option } from '@/components/ui/option-group';
import { Select } from '@/components/ui/select';
import { Text } from '@/components/ui/text';
import { useCurrentGroup } from '@/features/groups/current-group';
import { formatFullDate } from '@/features/plans/labels';
import { useCreatePlan } from '@/features/plans/use-plans';
import { useTags } from '@/features/tags/use-tags';
import { describeBackfill, toIsoDate, utcDate } from '@/lib/cycles';
import type { PlanFrequency, PlanKind } from '@/lib/domain';
import type { CurrencyCode, Minor } from '@/lib/money';

const KIND_OPTIONS: readonly Option<PlanKind>[] = [
  { value: 'dues', label: 'Dues', hint: 'Regular membership fee' },
  { value: 'contribution', label: 'Contribution', hint: 'Towards a shared goal' },
  { value: 'levy', label: 'One-off levy', hint: 'A single event' },
  // Built and working, but held back from users until it has been tested on its
  // own. Shown so people know it is coming; not choosable. The database still
  // accepts `rotating`, and existing susu plans keep working — this only closes
  // the door to creating new ones. Remove `disabled` and `badge` to open it.
  {
    value: 'rotating',
    label: 'Susu',
    hint: 'Members take turns',
    disabled: true,
    badge: 'Coming soon',
  },
  { value: 'savings', label: 'Savings', hint: 'Held for the member' },
  { value: 'open', label: 'Open giving', hint: 'Any amount' },
];

const FREQUENCY_OPTIONS: readonly Option<PlanFrequency>[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
  { value: 'once', label: 'One time' },
];

export default function NewPlanScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { membership } = useCurrentGroup();
  const createPlan = useCreatePlan();

  const currency = (membership?.currency ?? 'GHS') as CurrencyCode;

  const [name, setName] = useState('');
  const [kind, setKind] = useState<PlanKind>('dues');
  const [frequency, setFrequency] = useState<PlanFrequency>('monthly');
  const [amount, setAmount] = useState<Minor | null>(null);
  const [graceDays, setGraceDays] = useState('7');
  const [audienceTagId, setAudienceTagId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tags = useTags(membership?.groupId);

  const now = new Date();
  const [start, setStart] = useState({
    day: now.getDate(),
    month: now.getMonth(),
    year: now.getFullYear(),
  });
  const [close, setClose] = useState(() => {
    const in30 = new Date();
    in30.setDate(in30.getDate() + 30);
    return { day: in30.getDate(), month: in30.getMonth(), year: in30.getFullYear() };
  });

  const needsAmount = kind !== 'open';
  const effectiveFrequency: PlanFrequency = kind === 'levy' ? 'once' : frequency;
  const isOneOff = effectiveFrequency === 'once';

  // A susu already has an audience — the members in its rotation — so offering
  // a tag as well would be two answers to the same question.
  const canScopeToTag = kind !== 'rotating';
  const availableTags = tags.data ?? [];
  const chosenTag = availableTags.find((t) => t.id === audienceTagId) ?? null;

  // Yearly keeps its month. A group's year does not have to be the calendar's —
  // December to November is an ordinary subscription year, and forcing January
  // would silently move everybody's due date.
  //
  // The month is not defaulted or nudged either: the caption below spells out
  // the span the current choice produces, which is more honest than guessing
  // what a group means by "yearly" and quietly being wrong.
  const isYearly = effectiveFrequency === 'yearly';

  // Recurring plans start at the top of a period; one-offs run between two real dates.
  const startDate = isOneOff
    ? utcDate(start.year, start.month, start.day)
    : utcDate(start.year, start.month);
  const closeDate = utcDate(close.year, close.month, close.day);
  const closesBeforeStart = closeDate < startDate;

  const backfillSummary = describeBackfill(effectiveFrequency, startDate);

  async function handleSubmit() {
    setError(null);

    if (name.trim().length === 0) {
      setError('Give this contribution a name');
      return;
    }
    if (needsAmount && (amount === null || amount <= 0)) {
      setError('Set how much each member contributes');
      return;
    }
    if (isOneOff && closesBeforeStart) {
      setError('The closing date cannot be before the day collection opens');
      return;
    }
    if (!membership) return;

    try {
      await createPlan.mutateAsync({
        groupId: membership.groupId,
        name,
        kind,
        // A one-off levy is conceptually a single cycle, so keep the two in step
        // rather than letting someone create a "monthly one-off".
        frequency: effectiveFrequency,
        defaultAmount: needsAmount ? amount : null,
        graceDays: Number.parseInt(graceDays, 10) || 0,
        startDate: toIsoDate(startDate),
        endDate: isOneOff ? toIsoDate(closeDate) : null,
        audienceTagId: canScopeToTag ? audienceTagId : null,
      });
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the plan. Try again.');
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-background">
      <View
        className="flex-row items-center justify-between px-5 pb-3"
        style={{ paddingTop: insets.top + 8 }}>
        <Text variant="title">New contribution</Text>
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
          placeholder="Monthly Dues"
          autoCapitalize="words"
        />

        {/* Six kinds with a sentence each is a lot of vertical space before the
            rest of the form. Collapsed, the choice still reads clearly. */}
        <Select label="What kind?" options={KIND_OPTIONS} value={kind} onChange={setKind} />

        {kind !== 'levy' && (
          <OptionGroup
            label="How often?"
            options={FREQUENCY_OPTIONS}
            value={frequency}
            onChange={setFrequency}
          />
        )}

        {/* Who owes it. Everything downstream is derived from the obligations
            this issues, so narrowing the audience needs no other change. */}
        {canScopeToTag && (
          <View className="gap-2">
            <OptionGroup
              label="Who is it for?"
              options={[
                { value: 'all', label: 'Everyone', hint: 'All active members' },
                ...availableTags.map((tag) => ({
                  value: tag.id,
                  label: tag.name,
                  hint: `${tag.memberCount} ${tag.memberCount === 1 ? 'member' : 'members'}`,
                })),
              ]}
              value={audienceTagId ?? 'all'}
              onChange={(value) => setAudienceTagId(value === 'all' ? null : value)}
            />

            {availableTags.length === 0 ? (
              <Text variant="caption">
                To bill only some members, create a tag such as Executives under More → Tags first.
              </Text>
            ) : chosenTag !== null && chosenTag.memberCount === 0 ? (
              <View className="rounded-lg bg-warning/10 p-3">
                <Text variant="caption" className="text-warning">
                  Nobody carries {chosenTag.name} yet, so this would collect nothing. Add members to
                  the tag under More → Tags.
                </Text>
              </View>
            ) : null}
          </View>
        )}

        {kind === 'rotating' && (
          <View className="rounded-lg bg-secondary/60 p-3">
            <Text variant="caption">
              You choose who is in the susu when you set the running order, straight after creating
              it. Only those members contribute.
            </Text>
          </View>
        )}

        {needsAmount && (
          <MoneyInput
            label="How much from each member?"
            currency={currency}
            value={amount}
            onChange={setAmount}
          />
        )}

        {isOneOff ? (
          <View className="gap-4">
            <DateField label="When does collection open?" value={start} onChange={setStart} />

            <DateField label="When does it close?" value={close} onChange={setClose} />

            <View
              className={`rounded-lg p-3 ${
                closesBeforeStart ? 'bg-destructive/10' : 'bg-secondary/60'
              }`}>
              <Text
                variant="caption"
                className={closesBeforeStart ? 'text-destructive' : undefined}>
                {closesBeforeStart
                  ? 'The closing date cannot be before the day collection opens.'
                  : `Collected once. Open ${formatFullDate(toIsoDate(startDate))}, due by ${formatFullDate(toIsoDate(closeDate))}.`}
              </Text>
            </View>
          </View>
        ) : (
          <View className="gap-2">
            <MonthYearPicker
              label={isYearly ? 'When does the year start?' : 'When did it start?'}
              month={start.month}
              year={start.year}
              onChange={(next) => setStart({ ...next, day: 1 })}
            />

            {/* Says the span out loud, because "December" as a yearly start is
                easy to read as "due in December" rather than "the year runs
                from December". */}
            {isYearly && (
              <Text variant="caption">
                {start.month === 0
                  ? `Each period is the calendar year — the first is ${start.year}.`
                  : `Each period runs ${MONTHS[start.month]} to ${MONTHS[(start.month + 11) % 12]} — the first is ${start.year}/${String((start.year + 1) % 100).padStart(2, '0')}.`}
              </Text>
            )}
            <View className="rounded-lg bg-secondary/60 p-3">
              <Text variant="caption">{backfillSummary}</Text>
            </View>
          </View>
        )}

        <Input
          label="Days of grace after the due date"
          value={graceDays}
          onChangeText={setGraceDays}
          keyboardType="number-pad"
          inputMode="numeric"
          placeholder="7"
        />

        {error && (
          <View className="rounded-lg bg-destructive/10 p-3">
            <Text variant="caption" className="text-destructive">
              {error}
            </Text>
          </View>
        )}

        <Button
          label="Create contribution"
          size="lg"
          fullWidth
          loading={createPlan.isPending}
          onPress={handleSubmit}
        />

        <Text variant="caption" className="text-center">
          {kind === 'rotating'
            ? 'The first collection period opens straight away. Set the running order next to choose who is in the susu.'
            : chosenTag !== null
              ? `The first collection period opens straight away, and everyone carrying ${chosenTag.name} will be shown what they owe.`
              : 'The first collection period opens straight away, and every active member will be shown what they owe.'}
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
