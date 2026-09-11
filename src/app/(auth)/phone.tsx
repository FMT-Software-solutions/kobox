import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { ghanaNetwork, parseGhanaPhone } from '@/lib/phone';
import { describeAuthError } from '@/lib/auth-errors';
import { supabase } from '@/lib/supabase';

/**
 * Step one of phone sign-in: prove which number you are claiming.
 *
 * Supabase generates, hashes, expires and rate-limits the code; the Send SMS
 * hook only carries it to Arkesel. Nothing here ever sees or stores an OTP.
 */
export default function PhoneSignInScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  const trimmed = phone.trim();
  const parsed = trimmed === '' ? null : parseGhanaPhone(trimmed);
  const fieldError = parsed !== null && !parsed.ok ? parsed.message : null;
  const network = trimmed === '' ? null : ghanaNetwork(trimmed);
  const canSend = parsed !== null && parsed.ok;

  async function handleSend() {
    setError(null);
    if (parsed === null || !parsed.ok) {
      setError(parsed === null ? 'Enter your phone number' : parsed.message);
      return;
    }

    setIsSending(true);
    try {
      // shouldCreateUser stays on: a member recorded by their treasurer has no
      // account yet, and the first sign-in is exactly when it should be made.
      const { error: otpError } = await supabase.auth.signInWithOtp({ phone: parsed.e164 });
      if (otpError) throw otpError;

      router.push({ pathname: '/verify', params: { phone: parsed.e164 } });
    } catch (err) {
      setError(describeAuthError(err, 'Could not send the code. Try again.'));
    } finally {
      setIsSending(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-background">
      <View className="flex-row items-center px-5 pb-3" style={{ paddingTop: insets.top + 8 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => router.back()}
          className="-ml-2 rounded-full p-2 active:bg-secondary">
          <ChevronLeft size={22} color="#66756F" />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        contentContainerClassName="gap-6 px-6 pt-2"
        keyboardShouldPersistTaps="handled">
        <View className="gap-2">
          <Text variant="display">Your number</Text>
          <Text variant="muted">
            We will text you a 6-digit code. Use the number your group has for you.
          </Text>
        </View>

        <View className="gap-1.5">
          <Input
            label="Phone number"
            value={phone}
            onChangeText={setPhone}
            placeholder="024 123 4567"
            keyboardType="phone-pad"
            inputMode="tel"
            autoCorrect={false}
            autoFocus
            error={fieldError ?? undefined}
          />
          {network && <Text variant="caption">{network}</Text>}
        </View>

        {error && (
          <View className="rounded-lg bg-destructive/10 p-3">
            <Text variant="caption" className="text-destructive">
              {error}
            </Text>
          </View>
        )}

        <Button
          label="Send me a code"
          size="lg"
          fullWidth
          disabled={!canSend}
          loading={isSending}
          onPress={handleSend}
        />

        <Text variant="caption" className="text-center">
          Standard SMS rates from your network may apply.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
