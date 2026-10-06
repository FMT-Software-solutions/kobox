import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import {
  Bell,
  Check,
  ChevronRight,
  Copy,
  FileText,
  LogOut,
  MessageSquare,
  Plus,
  Receipt,
  RefreshCw,
  Send,
  Settings,
  Share2,
  ShieldCheck,
  ShieldOff,
  Tags as TagsIcon,
  Users,
} from 'lucide-react-native';
import { useState } from 'react';
import { Platform, Pressable, ScrollView, Share, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { useSession } from '@/features/auth/session-provider';
import { WEB_APP_URL } from '@/lib/backend';
import { useBrand } from '@/features/groups/brand';
import { useCurrentGroup } from '@/features/groups/current-group';
import {
  useInviteSettings,
  useJoinRequests,
  useMyJoinRequests,
  useRegenerateJoinCode,
  useSetJoinPolicy,
} from '@/features/groups/use-membership';
import { unregisterPushToken } from '@/features/notifications/push';
import { useMyProfile } from '@/features/profile/use-profile';
import { ROLE_RANK, type MemberRole } from '@/lib/domain';
import { supabase } from '@/lib/supabase';

/**
 * `href: null` marks a destination that does not exist yet.
 *
 * `minRole` is who the entry is FOR, not merely who may act in it. An ordinary
 * member could already see Tags and Expenses without being able to change
 * anything, which made the app look like it was full of buttons that did not
 * work. Every one of these is a treasurer's or an admin's tool; a member's view
 * of the money is the dashboard and their statement.
 */
const SECTIONS = [
  {
    title: 'Group',
    items: [
      {
        key: 'members',
        label: 'Members',
        hint: 'Who is in this group',
        icon: Users,
        href: '/members' as const,
        minRole: 'member' as MemberRole,
      },
      {
        key: 'tags',
        label: 'Tags',
        hint: 'Executives, committees & other sub-groups',
        icon: TagsIcon,
        href: '/tags' as const,
        minRole: 'treasurer' as MemberRole,
      },
      {
        key: 'expenses',
        label: 'Expenses',
        hint: 'Money going out',
        icon: Receipt,
        href: '/expenses' as const,
        minRole: 'treasurer' as MemberRole,
      },
      {
        key: 'reports',
        label: 'Reports',
        hint: 'Cash book, arrears, exports',
        icon: FileText,
        href: '/reports' as const,
        // Auditor and above. The role existed and unlocked nothing until now;
        // read-only sight of the books is exactly what it is for.
        minRole: 'auditor' as MemberRole,
      },
      {
        key: 'messages',
        label: 'Messages',
        hint: 'Text or notify members',
        icon: Send,
        href: '/messages' as const,
        // Admin and up: a text spends the group's credit.
        minRole: 'admin' as MemberRole,
      },
    ],
  },
  {
    title: 'Preferences',
    items: [
      {
        key: 'reminders',
        label: 'Reminders',
        hint: 'What this group may send you',
        icon: Bell,
        href: '/reminders' as const,
        // Everyone: these are your own settings, not the group's.
        minRole: 'member' as MemberRole,
      },
      {
        key: 'sms',
        label: 'Text messages',
        hint: 'Credits, sender ID & limits',
        icon: MessageSquare,
        href: '/sms' as const,
        // Buying credits spends the group's money, so admin and up — the same
        // bar as the invite code, and for the same reason.
        minRole: 'admin' as MemberRole,
      },
      {
        key: 'audit',
        label: 'Audit log',
        hint: 'Every change, recorded',
        icon: ShieldCheck,
        href: null,
        minRole: 'admin' as MemberRole,
      },
      {
        key: 'settings',
        label: 'Settings',
        // Everyone: the group's details are for admins, but appearance,
        // profile and reminders are every member's own.
        hint: 'Group details, colour & appearance',
        icon: Settings,
        href: '/settings' as const,
        minRole: 'member' as MemberRole,
      },
    ],
  },
] as const;

export default function MoreScreen() {
  const brand = useBrand();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { membership, memberships, selectGroup } = useCurrentGroup();
  const { session } = useSession();
  const profile = useMyProfile();

  const rank = membership ? ROLE_RANK[membership.role as MemberRole] : 0;
  const canInvite = rank >= ROLE_RANK.admin;

  const invite = useInviteSettings(canInvite ? membership?.groupId : undefined);
  const joinRequests = useMyJoinRequests();
  // Requests INTO the current group, which only an admin may act on.
  const groupRequests = useJoinRequests(membership?.groupId, canInvite);
  const pendingCount = groupRequests.data?.length ?? 0;
  const regenerate = useRegenerateJoinCode();
  const policy = useSetJoinPolicy();

  // The membership row carries a copy of the code, so the card renders
  // immediately and the fresher server value takes over when it lands.
  const code = invite.data?.joinCode ?? membership?.joinCode ?? '';
  const isExpired = invite.data?.isExpired ?? false;
  const requiresApproval = invite.data?.requiresApproval ?? true;

  const [copied, setCopied] = useState(false);

  // The profile name is the real answer to "who am I"; the account email is
  // only a fallback for an account that somehow has neither.
  const displayName = profile.data?.fullName?.trim() || session?.user.email || 'You';

  async function copyJoinCode() {
    if (!code) return;
    await Clipboard.setStringAsync(code);
    setCopied(true);
    // Long enough to read, short enough that the code is never left looking
    // like it has been permanently replaced by a tick.
    setTimeout(() => setCopied(false), 2000);
  }

  function shareJoinCode() {
    if (!membership) return;
    // React Native's own Share sheet, so the invite goes wherever the person
    // already talks to their group — WhatsApp, SMS, anywhere. No extra
    // dependency and no per-app integration to keep working.
    const message =
      `Join ${membership.groupName} on Kobox: ${WEB_APP_URL}\n\n` +
      `Use this code when you sign up: ${code}` +
      (invite.data?.expiresAt
        ? `\n\nThe code stops working on ${new Date(invite.data.expiresAt).toLocaleDateString()}.`
        : '');

    Share.share({ message }).catch(async (err: unknown) => {
      // Dismissing the sheet is not an error worth reporting.
      if (Platform.OS !== 'web') return;
      if (err instanceof Error && err.name === 'AbortError') return;

      // A desktop browser has no share sheet at all, so the whole invitation
      // goes to the clipboard and the code row says so.
      await Clipboard.setStringAsync(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: 32 }}
        contentContainerClassName="gap-5 px-5"
        showsVerticalScrollIndicator={false}>
        <Text variant="title">More</Text>

        {/* Who am I, and what can I do here */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Edit your profile"
          onPress={() => router.push('/profile')}
          className="active:opacity-70">
          <Card className="flex-row items-center gap-3">
            <Avatar name={displayName} uri={profile.data?.avatarUrl} size="lg" />
            <View className="flex-1">
              <Text variant="heading" numberOfLines={1}>
                {displayName}
              </Text>
              <Text variant="caption" numberOfLines={1}>
                {membership?.groupName ?? 'No group'}
              </Text>
            </View>
            {membership && <Badge label={membership.role} tone="neutral" className="capitalize" />}
            <ChevronRight size={18} color="#9AA8A3" />
          </Card>
        </Pressable>

        {/* Shown even with a single group: besides the dashboard header, this
            is the only way to join or start another one, and that had no way in
            at all for anyone who already belonged somewhere. */}
        {memberships.length > 0 && (
          <View>
            <Text variant="label" className="mb-2 text-muted-foreground">
              Your groups
            </Text>
            <Card className="gap-0 p-0">
              {memberships.map((item, index) => {
                const isCurrent = item.groupId === membership?.groupId;
                return (
                  <Pressable
                    key={item.groupId}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isCurrent }}
                    accessibilityLabel={`Switch to ${item.groupName}`}
                    onPress={() => selectGroup(item.groupId)}
                    className={`flex-row items-center gap-3 p-4 active:bg-secondary ${
                      index > 0 ? 'border-t border-border' : ''
                    }`}>
                    <Avatar name={item.groupName} size="sm" />
                    <View className="flex-1">
                      <Text variant="label" numberOfLines={1}>
                        {item.groupName}
                      </Text>
                      <Text variant="caption" className="capitalize">
                        {item.role}
                      </Text>
                    </View>
                    {isCurrent ? (
                      <Check size={18} color={brand.hex} />
                    ) : (
                      <ChevronRight size={18} color="#9AA8A3" />
                    )}
                  </Pressable>
                );
              })}

              {/* Requests still waiting. Listed beside the real memberships
                  because "which groups am I in?" and "which am I waiting on?"
                  are the same question to the person asking — and until now the
                  only place a request was visible was the onboarding screen
                  they had already navigated away from. */}
              {(joinRequests.data ?? []).map((request) => (
                <View
                  key={request.memberId}
                  className="flex-row items-center gap-3 border-t border-border p-4">
                  <Avatar name={request.groupName} size="sm" className="opacity-50" />
                  <View className="flex-1">
                    <Text variant="label" numberOfLines={1} className="text-muted-foreground">
                      {request.groupName}
                    </Text>
                    <Text variant="caption">
                      Asked {new Date(request.requestedAt).toLocaleDateString()} · waiting for an
                      admin
                    </Text>
                  </View>
                  <Badge label="Pending" tone="warning" />
                </View>
              ))}

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Join or create another group"
                onPress={() => router.push('/onboarding')}
                className="flex-row items-center gap-3 border-t border-border p-4 active:bg-secondary">
                <View className="h-10 w-10 items-center justify-center rounded-full bg-secondary">
                  <Plus size={18} color={brand.hex} />
                </View>
                <Text variant="label" className="flex-1 text-primary">
                  Join or create another group
                </Text>
                <ChevronRight size={18} color="#9AA8A3" />
              </Pressable>
            </Card>
          </View>
        )}

        {/* The join code is how new members get in — make it easy to read out,
            and easier still to send. Reading a code down a phone line is where
            invites actually fail. */}
        {membership && canInvite && (
          <Card className="items-center gap-3">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Copy the join code ${code}`}
              onPress={copyJoinCode}
              className="items-center gap-1 active:opacity-70">
              <Text variant="caption">Invite people with this code</Text>
              <View className="flex-row items-center gap-2">
                <Text
                  variant="display"
                  className={`tracking-widest ${isExpired ? 'text-muted-foreground line-through' : ''}`}>
                  {code}
                </Text>
                {copied ? (
                  <Check size={20} color={brand.hex} />
                ) : (
                  <Copy size={20} color="#9AA8A3" />
                )}
              </View>
              <Text variant="caption">{copied ? 'Copied' : 'Tap to copy'}</Text>
            </Pressable>

            {/* An invite that never lapses is a permanent open door onto the
                group's money. Say plainly when this one shuts. */}
            {isExpired ? (
              <View className="w-full rounded-lg bg-destructive/10 p-3">
                <Text variant="caption" className="text-center text-destructive">
                  This code has expired. Generate a new one to invite anybody else.
                </Text>
              </View>
            ) : (
              invite.data?.expiresAt && (
                <Text variant="caption">
                  Works until {new Date(invite.data.expiresAt).toLocaleDateString()}
                </Text>
              )
            )}

            <View className="flex-row gap-2">
              <Button
                label="Share invite"
                size="sm"
                variant="outline"
                disabled={isExpired}
                icon={<Share2 size={16} color={brand.deep} />}
                onPress={shareJoinCode}
              />
              <Button
                label="New code"
                size="sm"
                variant="outline"
                loading={regenerate.isPending}
                icon={<RefreshCw size={16} color={brand.deep} />}
                onPress={() => regenerate.mutate({ groupId: membership.groupId })}
              />
            </View>

            {/* The default is to vet people. Turning it off is a deliberate act
                and reads as one. */}
            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: requiresApproval }}
              accessibilityLabel="Approve everyone who uses this code"
              disabled={policy.isPending}
              onPress={() =>
                policy.mutate({
                  groupId: membership.groupId,
                  requiresApproval: !requiresApproval,
                })
              }
              className="w-full flex-row items-center gap-3 rounded-lg border border-border p-3 active:bg-secondary">
              {requiresApproval ? (
                <ShieldCheck size={18} color={brand.hex} />
              ) : (
                <ShieldOff size={18} color="#9AA8A3" />
              )}
              <View className="flex-1">
                <Text variant="label">
                  {requiresApproval ? 'Approve each person' : 'Anyone with the code joins'}
                </Text>
                <Text variant="caption">
                  {requiresApproval
                    ? 'People who use the code wait for approval. Tap to change.'
                    : 'No approval needed — anyone holding the code is let straight in.'}
                </Text>
              </View>
            </Pressable>
          </Card>
        )}

        {SECTIONS.map((section) => {
          const items = section.items.filter((item) => rank >= ROLE_RANK[item.minRole]);
          // A heading over an empty card is worse than no heading.
          if (items.length === 0) return null;

          return (
            <View key={section.title}>
              <Text variant="label" className="mb-2 text-muted-foreground">
                {section.title}
              </Text>

              <Card className="gap-0 p-0">
                {items.map((item, index) => {
                  const Icon = item.icon;
                  const isReady = item.href !== null;
                  return (
                    <Pressable
                      key={item.key}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: !isReady }}
                      disabled={!isReady}
                      onPress={isReady ? () => router.push(item.href) : undefined}
                      className={`flex-row items-center gap-3 p-4 ${
                        isReady ? 'active:bg-secondary' : 'opacity-40'
                      } ${index > 0 ? 'border-t border-border' : ''}`}>
                      <Icon size={18} color={brand.hex} />
                      <View className="flex-1">
                        <Text variant="label">{item.label}</Text>
                        {item.hint && <Text variant="caption">{item.hint}</Text>}
                      </View>
                      {/* The count travels with the row that leads to the work,
                          so an admin who opens More sees it without having to
                          remember to look. */}
                      {item.key === 'members' && pendingCount > 0 && (
                        <Badge label={`${pendingCount} waiting`} tone="warning" />
                      )}
                      {isReady ? (
                        <ChevronRight size={18} color="#9AA8A3" />
                      ) : (
                        <Text variant="caption">Soon</Text>
                      )}
                    </Pressable>
                  );
                })}
              </Card>
            </View>
          );
        })}

        <Button
          variant="outline"
          label="Sign out"
          fullWidth
          icon={<LogOut size={18} color="#D14343" />}
          onPress={async () => {
            // Drop this device's token BEFORE signing out — the delete needs the
            // session RLS checks it against. Skipping it left a shared phone
            // buzzing with the previous person's payment receipts.
            await unregisterPushToken();
            await supabase.auth.signOut();
          }}
        />

        <Text variant="caption" className="text-center">
          Kobox v1.0.0
        </Text>
      </ScrollView>
    </View>
  );
}
