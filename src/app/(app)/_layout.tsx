import { Redirect, Stack, usePathname } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { useSession } from '@/features/auth/session-provider';
import { useClaimMemberships } from '@/features/auth/use-linking';
import { BrandScope } from '@/features/groups/brand';
import { CurrentGroupProvider } from '@/features/groups/current-group';
import { useMyMemberships } from '@/features/groups/use-groups';
import { useRegisterPush } from '@/features/notifications/use-push';
import { useMyProfile } from '@/features/profile/use-profile';

/**
 * Guards everything behind sign-in and walks a new arrival through the three
 * things the app cannot work without, in the order it needs them:
 *
 *   name  →  verified phone  →  a group
 *
 * The order is not cosmetic. `create_group` and `join_group` both read
 * `profiles.full_name`, so asking for the name last would write 'Owner' or
 * 'Member' into the group. And `claim_memberships()` matches on a verified
 * phone alone, so a number added after joining is a number that arrives too
 * late to prevent a duplicate record.
 */
export default function AppLayout() {
  const { session } = useSession();
  const pathname = usePathname();
  const memberships = useMyMemberships();
  const profile = useMyProfile();

  // Claim any member record matching this account's verified phone before
  // deciding where to send them. Someone a treasurer already recorded has a
  // group — bouncing them to onboarding to type a join code would be wrong.
  const claim = useClaimMemberships(Boolean(session));

  // Fire-and-forget: a denied permission or a simulator returns null and the
  // app carries on. Never gated on, never awaited.
  useRegisterPush(Boolean(session));

  if (!session) {
    return <Redirect href="/sign-in" />;
  }

  const isOnboarding = pathname === '/onboarding';
  const isNaming = pathname === '/name';
  const isAddingPhone = pathname === '/add-phone';

  // Wait for the membership check before routing, otherwise a member with a
  // group would be bounced to onboarding for a frame on every cold start.
  if (memberships.isPending || claim.isPending || profile.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  const hasGroup = (memberships.data?.length ?? 0) > 0;
  const hasName = (profile.data?.fullName ?? '').trim() !== '';

  // Read from the session, not from `profiles`: this is the same pair
  // `current_verified_phone()` checks server-side, so the gate and the database
  // can never disagree about whether linking will work.
  const hasVerifiedPhone = Boolean(session.user.phone) && Boolean(session.user.phone_confirmed_at);

  if (!hasName && !isNaming) {
    return <Redirect href="/name" />;
  }

  if (hasName && isNaming) {
    return <Redirect href={hasGroup ? '/' : '/onboarding'} />;
  }

  if (hasName && !hasVerifiedPhone && !isAddingPhone) {
    return <Redirect href="/add-phone" />;
  }

  if (hasVerifiedPhone && isAddingPhone) {
    return <Redirect href={hasGroup ? '/' : '/onboarding'} />;
  }

  if (hasName && hasVerifiedPhone && !hasGroup && !isOnboarding) {
    return <Redirect href="/onboarding" />;
  }

  // Deliberately NOT the mirror of the rule above. Bouncing anyone who already
  // has a group off /onboarding made it unreachable for the one thing it is
  // also for: joining or starting a SECOND group. Onboarding navigates away
  // itself once it succeeds, so nobody is stranded there.

  return (
    <CurrentGroupProvider>
      {/* Inside the provider, because the brand belongs to whichever group is
          current and changes the moment somebody switches. */}
      <BrandScope>
        <Stack screenOptions={{ headerShown: false }} />
      </BrandScope>
    </CurrentGroupProvider>
  );
}
