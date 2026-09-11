import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { rememberSignIn } from '@/features/auth/last-login';
import { describeAuthError } from '@/lib/auth-errors';
import { supabase } from '@/lib/supabase';

const credentialsSchema = z.object({
  email: z.string().trim().min(1, 'Enter your email').email('That does not look like an email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

type Mode = 'sign-in' | 'sign-up';

export default function EmailSignInScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [mode, setMode] = useState<Mode>('sign-in');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit() {
    setFormError(null);
    setNotice(null);

    const parsed = credentialsSchema.safeParse({ email, password });
    if (!parsed.success) {
      const errors: { email?: string; password?: string } = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === 'email' || field === 'password') errors[field] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    setIsSubmitting(true);

    try {
      if (mode === 'sign-in') {
        const { error } = await supabase.auth.signInWithPassword(parsed.data);
        if (error) throw error;
        // Remember the door they came through, for the launch screen hint.
        await rememberSignIn('email', parsed.data.email);
        // On success the session listener redirects — nothing else to do here.
      } else {
        const { data, error } = await supabase.auth.signUp({
          ...parsed.data,
          options: { data: { full_name: fullName.trim() } },
        });
        if (error) throw error;

        // When email confirmation is switched on, Supabase returns a user with
        // no session. Say so plainly instead of leaving the user on a dead screen.
        if (!data.session) {
          setNotice('Check your email to confirm your account, then sign in.');
          setMode('sign-in');
        }
      }
    } catch (error) {
      setFormError(describeAuthError(error, 'Something went wrong. Try again.'));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-background">
      <View className="flex-row items-center px-5" style={{ paddingTop: insets.top + 8 }}>
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
        contentContainerClassName="grow justify-center gap-6 px-6"
        keyboardShouldPersistTaps="handled">
        <View className="gap-2">
          <Text variant="display">Kobox</Text>
          <Text variant="muted">
            {mode === 'sign-in'
              ? 'Welcome back. Sign in to see your group.'
              : 'Create an account to start tracking contributions.'}
          </Text>
        </View>

        <View className="gap-4">
          {mode === 'sign-up' && (
            <Input
              label="Your name"
              value={fullName}
              onChangeText={setFullName}
              autoCapitalize="words"
              autoComplete="name"
              placeholder="Ama Serwaa Boateng"
              textContentType="name"
            />
          )}

          <Input
            label="Email"
            value={email}
            onChangeText={setEmail}
            error={fieldErrors.email}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
            placeholder="you@example.com"
          />

          <Input
            label="Password"
            value={password}
            onChangeText={setPassword}
            error={fieldErrors.password}
            secureTextEntry
            autoCapitalize="none"
            autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
            textContentType={mode === 'sign-in' ? 'password' : 'newPassword'}
            placeholder="At least 8 characters"
          />

          {notice && (
            <View className="rounded-lg bg-success/10 p-3">
              <Text variant="caption" className="text-success">
                {notice}
              </Text>
            </View>
          )}

          {formError && (
            <View className="rounded-lg bg-destructive/10 p-3">
              <Text variant="caption" className="text-destructive">
                {formError}
              </Text>
            </View>
          )}

          <Button
            label={mode === 'sign-in' ? 'Sign in' : 'Create account'}
            size="lg"
            fullWidth
            loading={isSubmitting}
            onPress={handleSubmit}
          />

          <Button
            variant="ghost"
            label={
              mode === 'sign-in'
                ? 'New here? Create an account'
                : 'Already have an account? Sign in'
            }
            onPress={() => {
              setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in');
              setFormError(null);
              setFieldErrors({});
            }}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
