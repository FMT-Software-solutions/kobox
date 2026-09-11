import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { useSetMyName } from '@/features/profile/use-profile';

/**
 * Asked once, of anyone who arrives without a name.
 *
 * Email sign-up collects it on the form, but phone sign-up has nowhere to — an
 * OTP proves possession of a SIM and nothing else. Those users reached the app
 * with `profiles.full_name = ''`, and `create_group` / `join_group` then fall
 * back to a literal 'Owner' or 'Member', which is what a whole group ends up
 * calling them.
 *
 * This sits BEFORE onboarding on purpose: fixing the name afterwards would
 * leave the placeholder already written into `group_members`.
 */
export default function NameScreen() {
  const insets = useSafeAreaInsets();
  const setName = useSetMyName();

  const [name, setName_] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (name.trim() === '') {
      setError('Enter your name so your group knows who you are.');
      return;
    }

    try {
      await setName.mutateAsync(name.trim());
      // No navigation: the layout gate re-runs once the profile query
      // invalidates and lets them through on its own.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your name.');
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-background">
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 32 }}
        contentContainerClassName="grow justify-center gap-6 px-6"
        keyboardShouldPersistTaps="handled">
        <View className="gap-2">
          <Text variant="display">What should we call you?</Text>
          <Text variant="muted">
            Your group sees this name beside every payment you make, so use the one they know you
            by.
          </Text>
        </View>

        <View className="gap-4">
          <Input
            label="Your name"
            value={name}
            onChangeText={setName_}
            autoCapitalize="words"
            autoComplete="name"
            textContentType="name"
            placeholder="Ama Serwaa Boateng"
            autoFocus
          />

          {error && (
            <View className="rounded-lg bg-destructive/10 p-3">
              <Text variant="caption" className="text-destructive">
                {error}
              </Text>
            </View>
          )}

          <Button
            label="Continue"
            size="lg"
            fullWidth
            loading={setName.isPending}
            onPress={submit}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
