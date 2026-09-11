import { useRouter } from 'expo-router';
import { Mail, Smartphone } from 'lucide-react-native';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Badge } from '@/components/ui/badge';
import { Text } from '@/components/ui/text';
import { useForgetLastSignIn, useLastSignIn } from '@/features/auth/last-login';

/**
 * The way in.
 *
 * The choice here is HOW you sign in, never WHO you are. `role` lives on
 * group_members, so it is per-group: the same person is owner of the group they
 * created and an ordinary member of two others. A "member or admin?" question
 * would bake a per-group attribute into the identity and make belonging to
 * several groups unanswerable. One account, many memberships, role resolved per
 * group after sign-in.
 *
 * Whichever door someone used last is marked, because being signed out is
 * exactly when you cannot remember. The hint is masked and is never read as
 * part of authentication.
 */
export default function SignInScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const lastSignIn = useLastSignIn();
  const forget = useForgetLastSignIn();

  const last = lastSignIn.data;

  return (
    <ScrollView
      contentContainerStyle={{ paddingTop: insets.top + 48, paddingBottom: insets.bottom + 32 }}
      contentContainerClassName="grow justify-center gap-8 px-6">
      <View className="gap-2">
        <Text variant="display">Kobox</Text>
        <Text variant="muted">
          {last
            ? 'Welcome back. Pick up where you left off.'
            : 'Track your group contributions, dues and susu.'}
        </Text>
      </View>

      <View className="gap-3">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Continue with your phone number"
          onPress={() => router.push('/phone')}
          className={`flex-row items-center gap-4 rounded-xl border p-4 active:opacity-70 ${
            last?.method === 'phone' ? 'border-primary bg-primary/5' : 'border-border bg-card'
          }`}>
          <View className="rounded-lg bg-secondary p-2.5">
            <Smartphone size={22} color="#12A67B" />
          </View>
          <View className="flex-1">
            <View className="flex-row items-center gap-2">
              <Text variant="label">Continue with phone</Text>
              {last?.method === 'phone' && <Badge label="Last used" tone="accent" />}
            </View>
            <Text variant="caption">
              {last?.method === 'phone' ? last.hint : 'We text you a code. Most members use this.'}
            </Text>
          </View>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Continue with your email address"
          onPress={() => router.push('/email')}
          className={`flex-row items-center gap-4 rounded-xl border p-4 active:opacity-70 ${
            last?.method === 'email' ? 'border-primary bg-primary/5' : 'border-border bg-card'
          }`}>
          <View className="rounded-lg bg-secondary p-2.5">
            <Mail size={22} color="#12A67B" />
          </View>
          <View className="flex-1">
            <View className="flex-row items-center gap-2">
              <Text variant="label">Continue with email</Text>
              {last?.method === 'email' && <Badge label="Last used" tone="accent" />}
            </View>
            <Text variant="caption">
              {last?.method === 'email' ? last.hint : 'Email and password.'}
            </Text>
          </View>
        </Pressable>
      </View>

      {last && (
        <Pressable
          accessibilityRole="button"
          onPress={() => forget()}
          className="self-center p-2 active:opacity-60">
          <Text variant="caption">Not you? Clear this</Text>
        </Pressable>
      )}

      <Text variant="caption" className="text-center">
        Either way you get the same account. Whether you are a member or run the group is decided
        per group, not here.
      </Text>
    </ScrollView>
  );
}
