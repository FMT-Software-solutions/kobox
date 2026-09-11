import { useRouter } from 'expo-router';
import { X } from 'lucide-react-native';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { OptionGroup, type Option } from '@/components/ui/option-group';
import { Text } from '@/components/ui/text';
import { useCurrentGroup } from '@/features/groups/current-group';
import { useAddMember } from '@/features/members/use-members';
import { ROLE_RANK, type MemberRole } from '@/lib/domain';
import { ghanaNetwork, parseGhanaPhone } from '@/lib/phone';

const ROLE_OPTIONS: readonly Option<MemberRole>[] = [
  { value: 'member', label: 'Member', hint: 'Pays and views' },
  { value: 'treasurer', label: 'Treasurer', hint: 'Records payments' },
  { value: 'admin', label: 'Admin', hint: 'Manages the group' },
  { value: 'auditor', label: 'Auditor', hint: 'Views only' },
];

type ArrearsChoice = 'from-now' | 'from-start';

const ARREARS_OPTIONS: readonly Option<ArrearsChoice>[] = [
  { value: 'from-now', label: 'No, start fresh', hint: 'Current period on' },
  { value: 'from-start', label: 'Yes, include arrears', hint: 'Since each started' },
];

export default function NewMemberScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { membership } = useCurrentGroup();
  const addMember = useAddMember();

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<MemberRole>('member');
  const [arrears, setArrears] = useState<ArrearsChoice>('from-now');
  const [error, setError] = useState<string | null>(null);

  const isOwner =
    membership !== null && ROLE_RANK[membership.role as MemberRole] >= ROLE_RANK.owner;

  // A phone number is REQUIRED now. It is the only signal that links this
  // record to the person when they sign up — without one they always end up
  // with a second, empty record beside the history recorded here. Feedback is
  // live rather than on submit, because retyping a number after the fact is the
  // friction that got members recorded without one in the first place.
  const trimmedPhone = phone.trim();
  const parsedPhone = trimmedPhone === '' ? null : parseGhanaPhone(trimmedPhone);
  const phoneError = parsedPhone !== null && !parsedPhone.ok ? parsedPhone.message : null;
  const phoneNetwork = trimmedPhone === '' ? null : ghanaNetwork(trimmedPhone);

  async function handleSubmit() {
    setError(null);

    if (fullName.trim().length === 0) {
      setError("Enter the member's name");
      return;
    }
    if (trimmedPhone === '') {
      setError('Enter their phone number — it is how they find this record when they sign up.');
      return;
    }
    if (phoneError !== null) {
      setError(phoneError);
      return;
    }
    if (!parsedPhone?.ok) return;
    if (!membership) return;

    try {
      await addMember.mutateAsync({
        groupId: membership.groupId,
        fullName,
        // Store the canonical form; the database derives phone_e164 from it
        // either way, but sending what we already parsed keeps the two agreeing.
        phone: parsedPhone.e164,
        role,
        includePastPeriods: arrears === 'from-start',
      });
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the member. Try again.');
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-background">
      <View
        className="flex-row items-center justify-between px-5 pb-3"
        style={{ paddingTop: insets.top + 8 }}>
        <Text variant="title">Add a member</Text>
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
          label="Full name"
          value={fullName}
          onChangeText={setFullName}
          placeholder="Kwabena Mensah"
          autoCapitalize="words"
        />

        <Input
          label="Phone number"
          value={phone}
          onChangeText={setPhone}
          placeholder="024 123 4567"
          keyboardType="phone-pad"
          inputMode="tel"
          autoCorrect={false}
          error={phoneError ?? undefined}
        />

        {/* Their number is how they will one day sign in and see their own
            balance, so it is worth getting right while the treasurer is here. */}
        {phoneNetwork && (
          <Text variant="caption" className="-mt-4">
            {phoneNetwork} · they can sign in with this number
          </Text>
        )}

        <OptionGroup
          label="What can they do?"
          options={isOwner ? ROLE_OPTIONS : ROLE_OPTIONS.filter((o) => o.value !== 'admin')}
          value={role}
          onChange={setRole}
        />

        <View className="gap-1.5">
          <OptionGroup
            label="Do they owe the periods before today?"
            options={ARREARS_OPTIONS}
            value={arrears}
            onChange={setArrears}
          />
          <Text variant="caption">
            {arrears === 'from-now'
              ? 'They start with a clean slate and only owe the current period onwards.'
              : 'They inherit every closed period since each contribution started, as arrears.'}
          </Text>
        </View>

        {error && (
          <View className="rounded-lg bg-destructive/10 p-3">
            <Text variant="caption" className="text-destructive">
              {error}
            </Text>
          </View>
        )}

        <Button
          label="Add member"
          size="lg"
          fullWidth
          loading={addMember.isPending}
          onPress={handleSubmit}
        />

        <Text variant="caption" className="text-center">
          They do not need the app. You can record their payments for them, and if they join later
          with your group code they get their own login.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
