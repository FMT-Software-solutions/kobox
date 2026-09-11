import { useRouter } from 'expo-router';
import { CircleCheck, TriangleAlert } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { PublicPage } from '@/components/shared/public-page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { useDeleteAccount, useDeletionPreview } from '@/features/account/use-account';
import { useSession } from '@/features/auth/session-provider';
import { describeAuthError } from '@/lib/auth-errors';
import { parseGhanaPhone } from '@/lib/phone';
import { supabase } from '@/lib/supabase';

type Method = 'phone' | 'email';

/**
 * Signing in, just to delete.
 *
 * Self-contained rather than routed through the (auth) screens: those send a
 * signed-in person on to onboarding, and somebody here wants the opposite.
 * Phone codes are sent with `shouldCreateUser: false` — a deletion page that
 * quietly creates an account for a number it has never seen would be absurd.
 */
function SignIn() {
  const [method, setMethod] = useState<Method>('phone');
  const [phone, setPhone] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode() {
    setError(null);
    const parsed = parseGhanaPhone(phone.trim());
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    setBusy(true);
    try {
      const { error: otpError } = await supabase.auth.signInWithOtp({
        phone: parsed.e164,
        options: { shouldCreateUser: false },
      });
      if (otpError) throw otpError;
      setSentTo(parsed.e164);
    } catch (err) {
      setError(describeAuthError(err, 'Could not send the code. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode() {
    if (!sentTo) return;
    setError(null);
    setBusy(true);
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        phone: sentTo,
        token: code.replace(/\D/g, ''),
        type: 'sms',
      });
      if (verifyError) throw verifyError;
    } catch (err) {
      setError(describeAuthError(err, 'That code did not work. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function signInWithEmail() {
    setError(null);
    setBusy(true);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) throw signInError;
    } catch (err) {
      setError(describeAuthError(err, 'Could not sign in. Check your details.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="gap-4">
      <Text variant="label">Sign in to continue</Text>

      <View className="flex-row gap-2">
        {(['phone', 'email'] as const).map((option) => (
          <Pressable
            key={option}
            accessibilityRole="radio"
            accessibilityState={{ selected: method === option }}
            onPress={() => {
              setMethod(option);
              setError(null);
            }}
            className={`flex-1 items-center rounded-lg border py-2.5 ${
              method === option ? 'border-primary bg-primary/10' : 'border-border'
            }`}>
            <Text variant="label" className={method === option ? 'text-primary' : ''}>
              {option === 'phone' ? 'Phone' : 'Email'}
            </Text>
          </Pressable>
        ))}
      </View>

      {method === 'phone' ? (
        sentTo === null ? (
          <>
            <Input
              label="Phone number"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              autoComplete="tel"
              placeholder="024 123 4567"
            />
            <Button label="Send code" fullWidth loading={busy} onPress={sendCode} />
          </>
        ) : (
          <>
            <Input
              label="Code"
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="123456"
            />
            <Button label="Verify" fullWidth loading={busy} onPress={verifyCode} />
            <Button
              label="Use another number"
              variant="ghost"
              onPress={() => {
                setSentTo(null);
                setCode('');
              }}
            />
          </>
        )
      ) : (
        <>
          <Input
            label="Email"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
          />
          <Input
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
          />
          <Button label="Sign in" fullWidth loading={busy} onPress={signInWithEmail} />
        </>
      )}

      {error && (
        <Text variant="caption" className="text-destructive">
          {error}
        </Text>
      )}
    </Card>
  );
}

/**
 * Delete your account — the same screen in the app and at
 * kobox.fmtsoftware.com/delete-account, which Google Play requires.
 *
 * The confirmation is two taps on the same button, not a dialog: React
 * Native's `Alert` does nothing on the web, and this page's first job is to
 * work in a browser.
 */
export default function DeleteAccountScreen() {
  const router = useRouter();
  const { session, isLoading } = useSession();
  const preview = useDeletionPreview(session?.user.id);
  const remove = useDeleteAccount();

  const [armed, setArmed] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmDelete() {
    setError(null);
    try {
      await remove.mutateAsync();
      setDone(true);
    } catch (err) {
      setArmed(false);
      setError(err instanceof Error ? err.message : 'Your account could not be deleted.');
    }
  }

  if (done) {
    return (
      <PublicPage title="Delete account">
        <Card className="items-center gap-3 py-8">
          <CircleCheck size={32} color="#12A67B" />
          <Text variant="heading">Your account has been deleted</Text>
          <Button label="Done" variant="outline" onPress={() => router.replace('/sign-in')} />
        </Card>
      </PublicPage>
    );
  }

  const data = preview.data;
  const blocked = (data?.blocking.length ?? 0) > 0;
  const who = session?.user.phone ? `+${session.user.phone}` : (session?.user.email ?? '');

  return (
    <PublicPage title="Delete account">
      <Text className="leading-6 text-foreground">
        Deletes your Kobox account, profile and photo. Payments recorded in groups other people use
        stay with those groups.
      </Text>

      {isLoading ? (
        <ActivityIndicator />
      ) : !session ? (
        <SignIn />
      ) : preview.isPending ? (
        <Card>
          <ActivityIndicator />
        </Card>
      ) : preview.error ? (
        <Card>
          <Text variant="caption" className="text-destructive">
            {preview.error.message}
          </Text>
        </Card>
      ) : (
        <Card className="gap-4">
          <View className="flex-row items-center justify-between gap-3">
            <Text variant="label" className="shrink" numberOfLines={1}>
              {who}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => supabase.auth.signOut({ scope: 'local' })}
              className="active:opacity-60">
              <Text variant="caption" className="font-semibold text-primary">
                Not you?
              </Text>
            </Pressable>
          </View>

          {blocked && (
            <View className="gap-2 rounded-lg bg-warning/20 p-3">
              <View className="flex-row items-center gap-2">
                <TriangleAlert size={16} color="#B26B00" />
                <Text variant="label">Hand over first</Text>
              </View>
              <Text variant="caption">
                You are the only owner of {data!.blocking.map((group) => group.name).join(', ')}.
                Make someone else an owner, or delete the group.
              </Text>
            </View>
          )}

          {!blocked && (data?.deleting.length ?? 0) > 0 && (
            <View className="gap-1">
              <Text variant="label">Also deleted</Text>
              {data!.deleting.map((group) => (
                <Text key={group.id} variant="caption">
                  {group.name}
                </Text>
              ))}
            </View>
          )}

          {error && (
            <Text variant="caption" className="text-destructive">
              {error}
            </Text>
          )}

          {armed ? (
            <View className="gap-2">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Confirm: delete my account permanently"
                disabled={remove.isPending}
                onPress={confirmDelete}
                className="items-center rounded-lg bg-destructive py-3.5 active:opacity-80">
                {remove.isPending ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text className="font-semibold text-destructive-foreground">
                    Delete permanently
                  </Text>
                )}
              </Pressable>
              <Button
                label="Cancel"
                variant="ghost"
                disabled={remove.isPending}
                onPress={() => setArmed(false)}
              />
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              disabled={blocked}
              onPress={() => setArmed(true)}
              className={`items-center rounded-lg border border-destructive py-3.5 ${
                blocked ? 'opacity-40' : 'active:bg-destructive/10'
              }`}>
              <Text className="font-semibold text-destructive">Delete my account</Text>
            </Pressable>
          )}
        </Card>
      )}
    </PublicPage>
  );
}
