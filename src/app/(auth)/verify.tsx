import { useLocalSearchParams } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { rememberSignIn } from '@/features/auth/last-login';
import { formatGhanaPhone } from '@/lib/phone';
import { describeAuthError } from '@/lib/auth-errors';
import { supabase } from '@/lib/supabase';
import { goBack } from '@/lib/navigation';

const CODE_LENGTH = 6;

/**
 * Step two: the code proves possession of the SIM.
 *
 * That proof is what earns the right to claim the member record a treasurer
 * created — see `claim_memberships()`, which runs once the session exists.
 */
export default function VerifyOtpScreen() {
  const insets = useSafeAreaInsets();
  const { phone } = useLocalSearchParams<{ phone: string }>();

  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);

  const digits = code.replace(/\D/g, '').slice(0, CODE_LENGTH);
  const isComplete = digits.length === CODE_LENGTH;

  async function handleVerify() {
    setError(null);
    setNotice(null);

    if (!isComplete) {
      setError(`Enter the ${CODE_LENGTH}-digit code`);
      return;
    }

    setIsVerifying(true);
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        phone,
        token: digits,
        type: 'sms',
      });
      if (verifyError) throw verifyError;

      // Remember the door, for the launch screen next time. Masked on the way in.
      await rememberSignIn('phone', phone);
      // The session listener redirects from here; the app layout then claims any
      // member record matching this number.
    } catch (err) {
      setError(describeAuthError(err, 'That code did not work. Try again.'));
    } finally {
      setIsVerifying(false);
    }
  }

  async function handleResend() {
    setError(null);
    setNotice(null);
    setIsResending(true);
    try {
      const { error: otpError } = await supabase.auth.signInWithOtp({ phone });
      if (otpError) throw otpError;
      setNotice('We sent another code.');
    } catch (err) {
      // Supabase rate-limits resends per number; its message says how long to
      // wait, which is more useful than anything we could invent.
      setError(err instanceof Error ? err.message : 'Could not send another code just yet.');
    } finally {
      setIsResending(false);
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
          onPress={() => goBack()}
          className="-ml-2 rounded-full p-2 active:bg-secondary">
          <ChevronLeft size={22} color="#66756F" />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        contentContainerClassName="gap-6 px-6 pt-2"
        keyboardShouldPersistTaps="handled">
        <View className="gap-2">
          <Text variant="display">Enter the code</Text>
          <Text variant="muted">Sent to {formatGhanaPhone(phone ?? '')}.</Text>
        </View>

        <Input
          label="6-digit code"
          value={digits}
          onChangeText={setCode}
          placeholder="123456"
          keyboardType="number-pad"
          inputMode="numeric"
          autoComplete="sms-otp"
          textContentType="oneTimeCode"
          maxLength={CODE_LENGTH}
          autoFocus
        />

        {notice && (
          <View className="rounded-lg bg-success/10 p-3">
            <Text variant="caption" className="text-success">
              {notice}
            </Text>
          </View>
        )}

        {error && (
          <View className="rounded-lg bg-destructive/10 p-3">
            <Text variant="caption" className="text-destructive">
              {error}
            </Text>
          </View>
        )}

        <Button
          label="Verify and sign in"
          size="lg"
          fullWidth
          disabled={!isComplete}
          loading={isVerifying}
          onPress={handleVerify}
        />

        <Button
          label="Send another code"
          variant="ghost"
          loading={isResending}
          onPress={handleResend}
        />

        <Text variant="caption" className="text-center">
          The code expires in 10 minutes.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
