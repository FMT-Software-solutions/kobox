import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { useMyProfile } from '@/features/profile/use-profile';
import { describeAuthError } from '@/lib/auth-errors';
import { formatGhanaPhone, parseGhanaPhone } from '@/lib/phone';
import { supabase } from '@/lib/supabase';

/**
 * Adds a verified phone number to an account that signed up with email.
 *
 * Required rather than offered, because a phone number is the ONLY thing that
 * links a person to the member record a treasurer created for them. Without
 * one, an email user who joins a group always creates a second record beside
 * their own history — and it is also how the group texts them.
 *
 * The number is verified by OTP, not merely typed. An unverified number would
 * let anyone claim a record by typing someone else's digits, which is exactly
 * the hole `current_verified_phone()` exists to close.
 */
export default function AddPhoneScreen() {
  const insets = useSafeAreaInsets();
  const profile = useMyProfile();

  const [phone, setPhone] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  async function sendCode() {
    setError(null);

    const parsed = parseGhanaPhone(phone);
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }

    setIsBusy(true);
    try {
      // Supabase sends the OTP and owns the whole lifecycle — generation,
      // hashing, expiry, rate limiting and verification. We never see a code.
      const { error: updateError } = await supabase.auth.updateUser({ phone: parsed.e164 });
      if (updateError) throw updateError;
      setSentTo(parsed.e164);
    } catch (err) {
      setError(describeAuthError(err, 'Could not send the code. Try again in a moment.'));
    } finally {
      setIsBusy(false);
    }
  }

  async function verify() {
    setError(null);
    if (!sentTo) return;

    if (code.trim().length < 6) {
      setError('Enter the 6-digit code');
      return;
    }

    setIsBusy(true);
    try {
      // `phone_change`, not `sms`: this account already exists and is signed
      // in — we are attaching a number, not authenticating with one.
      const { error: verifyError } = await supabase.auth.verifyOtp({
        phone: sentTo,
        token: code.trim(),
        type: 'phone_change',
      });
      if (verifyError) throw verifyError;

      // The layout gate re-runs once the profile refetches, and
      // `claim_memberships()` now has a verified number to work with — so any
      // record a treasurer already made is picked up on the way through.
      await profile.refetch();
    } catch (err) {
      setError(describeAuthError(err, 'That code did not work. Try again.'));
    } finally {
      setIsBusy(false);
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
          <Text variant="display">Add your phone number</Text>
          <Text variant="muted">
            {sentTo
              ? `We sent a 6-digit code to ${formatGhanaPhone(sentTo)}.`
              : 'It stays private to you and the groups you belong to.'}
          </Text>
        </View>

        <View className="gap-4">
          {sentTo === null ? (
            <>
              <Input
                label="Phone number"
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                autoComplete="tel"
                textContentType="telephoneNumber"
                placeholder="024 123 4567"
                autoFocus
              />
              <Button label="Send code" size="lg" fullWidth loading={isBusy} onPress={sendCode} />
            </>
          ) : (
            <>
              <Input
                label="6-digit code"
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                autoComplete="sms-otp"
                textContentType="oneTimeCode"
                placeholder="123456"
                maxLength={6}
                autoFocus
              />
              <Button label="Confirm" size="lg" fullWidth loading={isBusy} onPress={verify} />
              <Button
                variant="ghost"
                label="Use a different number"
                disabled={isBusy}
                onPress={() => {
                  setSentTo(null);
                  setCode('');
                  setError(null);
                }}
              />
            </>
          )}

          {error && (
            <View className="rounded-lg bg-destructive/10 p-3">
              <Text variant="caption" className="text-destructive">
                {error}
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
