import { useRouter } from 'expo-router';
import { X } from 'lucide-react-native';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DateField } from '@/components/shared/date-field';
import { MoneyInput } from '@/components/shared/money-input';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { OptionGroup, type Option } from '@/components/ui/option-group';
import { Text } from '@/components/ui/text';
import { useRecordExpense } from '@/features/expenses/use-expenses';
import { useCurrentGroup } from '@/features/groups/current-group';
import { toIsoDate, utcDate } from '@/lib/cycles';
import { ROLE_RANK, type MemberRole } from '@/lib/domain';
import type { CurrencyCode, Minor } from '@/lib/money';

const CATEGORY_OPTIONS: readonly Option<string>[] = [
  { value: 'welfare', label: 'Welfare' },
  { value: 'refreshments', label: 'Refreshments' },
  { value: 'transport', label: 'Transport' },
  { value: 'rent', label: 'Rent & venue' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'general', label: 'Other' },
];

export default function NewExpenseScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { membership } = useCurrentGroup();
  const recordExpense = useRecordExpense();

  const currency = (membership?.currency ?? 'GHS') as CurrencyCode;
  const isAdmin =
    membership !== null && ROLE_RANK[membership.role as MemberRole] >= ROLE_RANK.admin;

  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState<Minor | null>(null);
  const [category, setCategory] = useState('general');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const now = new Date();
  const [spentOn, setSpentOn] = useState({
    day: now.getDate(),
    month: now.getMonth(),
    year: now.getFullYear(),
  });

  async function handleSubmit() {
    setError(null);

    if (title.trim().length === 0) {
      setError('Say what the money was spent on');
      return;
    }
    if (amount === null || amount <= 0) {
      setError('Enter an amount greater than zero');
      return;
    }
    if (!membership) return;

    const spentDate = utcDate(spentOn.year, spentOn.month, spentOn.day);
    if (spentDate > new Date()) {
      setError('An expense cannot be dated in the future');
      return;
    }

    try {
      await recordExpense.mutateAsync({
        groupId: membership.groupId,
        title: title.trim(),
        amount,
        category,
        note: note.trim() === '' ? null : note.trim(),
        spentAt: `${toIsoDate(spentDate)}T12:00:00.000Z`,
      });
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record the expense. Try again.');
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-background">
      <View
        className="flex-row items-center justify-between px-5 pb-3"
        style={{ paddingTop: insets.top + 8 }}>
        <Text variant="title">Record an expense</Text>
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
          label="What was it spent on?"
          value={title}
          onChangeText={setTitle}
          placeholder="Chairs for the meeting"
          autoCapitalize="sentences"
        />

        <MoneyInput label="How much?" currency={currency} value={amount} onChange={setAmount} />

        <OptionGroup
          label="What kind of expense?"
          options={CATEGORY_OPTIONS}
          value={category}
          onChange={setCategory}
        />

        <DateField label="When was it spent?" value={spentOn} onChange={setSpentOn} />

        <Input
          label="Note (optional)"
          value={note}
          onChangeText={setNote}
          placeholder="Receipt held by the secretary"
        />

        {error && (
          <View className="rounded-lg bg-destructive/10 p-3">
            <Text variant="caption" className="text-destructive">
              {error}
            </Text>
          </View>
        )}

        <Button
          label="Record expense"
          size="lg"
          fullWidth
          loading={recordExpense.isPending}
          onPress={handleSubmit}
        />

        <Text variant="caption" className="text-center">
          {isAdmin
            ? 'This counts against the group balance straight away.'
            : 'An admin will need to approve this before it counts against the group balance.'}
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
