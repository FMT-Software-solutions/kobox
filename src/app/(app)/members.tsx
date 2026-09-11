import { useRouter } from 'expo-router';
import { ChevronLeft, Plus, TriangleAlert, UserCheck, UserPlus } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/shared/empty-state';
import { MoneyText } from '@/components/shared/money-text';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { useAcknowledgeLinkNotice, useLinkNotices } from '@/features/auth/use-linking';
import { useBrand } from '@/features/groups/brand';
import { useCurrentGroup } from '@/features/groups/current-group';
import {
  useApproveJoinRequest,
  useDeclineJoinRequest,
  useJoinRequests,
} from '@/features/groups/use-membership';
import { useMembers, useSetMemberRole } from '@/features/members/use-members';
import { useTagsByMember } from '@/features/tags/use-tags';
import { ROLE_RANK, type MemberRole } from '@/lib/domain';
import type { CurrencyCode } from '@/lib/money';
import { formatGhanaPhone } from '@/lib/phone';

export default function MembersScreen() {
  const brand = useBrand();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { membership } = useCurrentGroup();
  const members = useMembers(membership?.groupId);
  const tagsByMember = useTagsByMember(membership?.groupId);
  const notices = useLinkNotices(membership?.groupId);
  const acknowledge = useAcknowledgeLinkNotice();
  const requests = useJoinRequests(membership?.groupId);
  const approve = useApproveJoinRequest();
  const decline = useDeclineJoinRequest();

  const setRole = useSetMemberRole();

  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [roleFor, setRoleFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currency = (membership?.currency ?? 'GHS') as CurrencyCode;
  const rank = membership ? ROLE_RANK[membership.role as MemberRole] : 0;

  /**
   * Two different questions, and they had been conflated.
   *
   * A treasurer records payments and adds members, so they need to tell people
   * apart — phone numbers, balances, roles, tags, and search by number.
   * Deciding who gets in and who holds authority is a separate matter and stays
   * with admins and owners.
   */
  const canSeeDetails = rank >= ROLE_RANK.treasurer;
  const canAddMembers = rank >= ROLE_RANK.treasurer;
  const canGovern = rank >= ROLE_RANK.admin;

  const needle = query.trim().toLowerCase();
  const digits = needle.replace(/\D/g, '');

  const matches = (members.data ?? []).filter((member) => {
    if (needle === '') return true;
    if (member.fullName.toLowerCase().includes(needle)) return true;
    // Searching by number is only offered to people who may see numbers —
    // otherwise a member could confirm who owns a phone by guessing at it,
    // which is the thing hiding the column was meant to prevent.
    if (canSeeDetails && digits.length >= 3 && member.phone) {
      return member.phone.replace(/\D/g, '').includes(digits);
    }
    return false;
  });

  // A long list is unreadable and slow to render on a mid-range phone. Search
  // is the way to reach someone specific; this is just the first screenful.
  const PREVIEW = 12;
  const visible = showAll || needle !== '' ? matches : matches.slice(0, PREVIEW);
  const hidden = matches.length - visible.length;

  const ASSIGNABLE: MemberRole[] = ['member', 'auditor', 'treasurer', 'admin'];

  async function changeRole(memberId: string, role: MemberRole) {
    setError(null);
    try {
      await setRole.mutateAsync({ memberId, role });
      setRoleFor(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change that role.');
    }
  }

  return (
    <View className="flex-1 bg-background">
      <View
        className="flex-row items-center justify-between gap-3 px-5 pb-3"
        style={{ paddingTop: insets.top + 8 }}>
        <View className="flex-1 flex-row items-center gap-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={() => router.back()}
            className="-ml-2 rounded-full p-2 active:bg-secondary">
            <ChevronLeft size={22} color="#66756F" />
          </Pressable>
          <Text variant="title">Members</Text>
        </View>

        {canAddMembers && (
          <Button
            label="Add"
            size="sm"
            icon={<Plus size={16} color="white" />}
            onPress={() => router.push('/members/new')}
          />
        )}
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        contentContainerClassName="gap-3 px-5 pt-2"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={members.isFetching} onRefresh={() => members.refetch()} />
        }>
        {members.isPending && (
          <Card>
            <ActivityIndicator />
          </Card>
        )}

        {/* Someone signed in and was matched to a record here. Auto-linking is
            what lets a member see their own history without an admin doing
            anything — but a mistyped number would match the wrong person, so
            every match is shown until an admin has looked at it. */}
        {canGovern &&
          (notices.data ?? []).map((notice) => (
            <Card
              key={notice.eventId}
              className={`gap-2 ${
                notice.kind === 'ambiguous' ? 'border-warning/40 bg-warning/5' : 'border-primary/30'
              }`}>
              <View className="flex-row items-start gap-3">
                {notice.kind === 'ambiguous' ? (
                  <TriangleAlert size={18} color="#B26B00" />
                ) : (
                  <UserCheck size={18} color={brand.hex} />
                )}
                <View className="flex-1">
                  <Text variant="label">
                    {notice.kind === 'ambiguous'
                      ? 'Two members share a phone number'
                      : `${notice.memberName ?? 'A member'} signed in`}
                  </Text>
                  <Text variant="caption">
                    {notice.kind === 'ambiguous'
                      ? `${formatGhanaPhone(notice.phone)} is on more than one member. Nobody was signed in to either record — remove the duplicate to fix it.`
                      : `They were matched to this record by ${formatGhanaPhone(notice.phone)}. If that is not them, change the number on their record.`}
                  </Text>
                </View>
              </View>
              <Button
                label="Got it"
                variant="ghost"
                size="sm"
                loading={acknowledge.isPending}
                onPress={() => acknowledge.mutate(notice.eventId)}
              />
            </Card>
          ))}

        {/* People waiting at the door. Above the member list on purpose: it is
            the only thing on this screen that somebody is waiting on. */}
        {canGovern && (requests.data ?? []).length > 0 && (
          <View className="gap-2">
            <Text variant="label">
              {requests.data!.length === 1
                ? '1 person wants to join'
                : `${requests.data!.length} people want to join`}
            </Text>

            {requests.data!.map((request) => (
              <Card key={request.memberId} className="gap-3 border-primary/30">
                <View className="flex-row items-start gap-3">
                  <UserCheck size={18} color={brand.hex} />
                  <View className="flex-1">
                    <Text variant="label">{request.fullName}</Text>
                    <Text variant="caption">
                      {request.phone ? formatGhanaPhone(request.phone) : 'No number'} · asked{' '}
                      {new Date(request.requestedAt).toLocaleDateString()}
                    </Text>
                    {/* Warn before the merge, not after: approving folds them
                        into the record an admin already made for that number. */}
                    {request.mergesInto && (
                      <Text variant="caption" className="mt-1 text-primary">
                        Will be joined to the existing record for {request.mergesInto}, keeping its
                        history.
                      </Text>
                    )}
                  </View>
                </View>

                <View className="flex-row gap-2">
                  <Button
                    label="Approve"
                    size="sm"
                    className="flex-1"
                    loading={approve.isPending}
                    onPress={() => approve.mutate({ memberId: request.memberId })}
                  />
                  <Button
                    label="Decline"
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    loading={decline.isPending}
                    onPress={() => decline.mutate(request.memberId)}
                  />
                </View>
              </Card>
            ))}
          </View>
        )}

        {!members.isPending && (members.data?.length ?? 0) === 0 && (
          <EmptyState
            icon={<UserPlus size={28} color="#9AA8A3" />}
            title="No members yet"
            description={
              canAddMembers
                ? 'Add the people in your group, or share your join code so they can join themselves.'
                : 'Nobody has been added to this group yet.'
            }
            actionLabel={canAddMembers ? 'Add a member' : undefined}
            onAction={canAddMembers ? () => router.push('/members/new') : undefined}
          />
        )}

        {/* Search once the list is long enough that scrolling is the slow way. */}
        {(members.data?.length ?? 0) > 8 && (
          <Input
            value={query}
            onChangeText={setQuery}
            placeholder={canSeeDetails ? 'Search by name or number' : 'Search by name'}
            autoCorrect={false}
            autoCapitalize="none"
            inputMode={canSeeDetails ? 'search' : 'text'}
            accessibilityLabel="Search members"
          />
        )}

        {needle !== '' && matches.length === 0 && (
          <Card>
            <Text variant="caption">Nobody matches “{query.trim()}”.</Text>
          </Card>
        )}

        {error && (
          <View className="rounded-lg bg-destructive/10 p-3">
            <Text variant="caption" className="text-destructive">
              {error}
            </Text>
          </View>
        )}

        {visible.map((member) => {
          const isSettled = member.balance <= 0;
          const memberTags = tagsByMember.data?.[member.id] ?? [];
          return (
            <Card key={member.id} className="gap-3">
              <Pressable
                accessibilityRole={canGovern ? 'button' : 'none'}
                accessibilityLabel={canGovern ? `Change ${member.fullName}'s role` : undefined}
                disabled={!canGovern}
                onPress={() => setRoleFor(roleFor === member.id ? null : member.id)}
                className="flex-row items-center gap-3">
                <Avatar name={member.fullName} />

                <View className="flex-1">
                  <View className="flex-row items-center gap-2">
                    <Text variant="label" numberOfLines={1} className="shrink">
                      {member.fullName}
                    </Text>

                    {/* Replaces the old "Has a Kobox account" line. Whether
                      somebody uses the app is a detail beside their name, not a
                      sentence about them — and it was crowding out the phone
                      number, which is the thing a treasurer came here for. */}
                    {member.hasAccount && (
                      <View
                        accessibilityLabel={`${member.fullName} uses Kobox`}
                        className="h-1.5 w-1.5 rounded-full bg-primary"
                      />
                    )}

                    {canSeeDetails && member.role !== 'member' && (
                      <Badge label={member.role} tone="neutral" className="capitalize" />
                    )}
                  </View>

                  {/* Everything below the name is the group's business, not every
                    member's. An ordinary member gets the list of who is in the
                    group — which is what they asked for — and nothing about
                    anyone else's number, role, sub-groups or debts. */}
                  {canSeeDetails && (
                    <>
                      <Text variant="caption" numberOfLines={1}>
                        {member.phone ? formatGhanaPhone(member.phone) : 'No phone number'}
                      </Text>

                      {/* Which sub-groups they belong to, and so which
                        contributions reach them at all. */}
                      {memberTags.length > 0 && (
                        <View className="mt-1 flex-row flex-wrap gap-1">
                          {memberTags.map((tag) => (
                            <View
                              key={tag.id}
                              className="flex-row items-center gap-1 rounded-full bg-secondary px-2 py-0.5">
                              <View
                                className="h-2 w-2 rounded-full"
                                style={{ backgroundColor: tag.colour }}
                              />
                              <Text variant="caption" className="text-secondary-foreground">
                                {tag.name}
                              </Text>
                            </View>
                          ))}
                        </View>
                      )}
                    </>
                  )}
                </View>

                {canSeeDetails && (
                  <View className="items-end">
                    {member.totalDue === 0 ? (
                      <Text variant="caption">Nothing due</Text>
                    ) : isSettled ? (
                      <Text variant="label" className="text-success">
                        Paid up
                      </Text>
                    ) : (
                      <>
                        <MoneyText
                          amount={member.balance}
                          currency={currency}
                          variant="label"
                          className="text-warning"
                        />
                        <Text variant="caption">owing</Text>
                      </>
                    )}
                  </View>
                )}
              </Pressable>

              {/* Roles decide what somebody can see as well as do, so this is
                  kept to admins and owners even though a treasurer may add
                  members. set_member_role also refuses the three cases the UI
                  cannot: appointing an owner without being one, demoting the
                  last owner, and changing your own role. */}
              {canGovern && roleFor === member.id && (
                <View className="gap-2 border-t border-border pt-3">
                  <Text variant="caption">Change what {member.fullName} can do</Text>
                  <View className="flex-row flex-wrap gap-2">
                    {ASSIGNABLE.map((role) => (
                      <Pressable
                        key={role}
                        accessibilityRole="button"
                        accessibilityState={{ selected: member.role === role }}
                        disabled={setRole.isPending || member.role === role}
                        onPress={() => changeRole(member.id, role)}
                        className={`rounded-full border px-3 py-1.5 ${
                          member.role === role
                            ? 'border-primary bg-primary/10'
                            : 'border-border active:bg-secondary'
                        }`}>
                        <Text variant="caption" className="capitalize">
                          {role}
                        </Text>
                      </Pressable>
                    ))}
                  </View>

                  {/* Same bar as the role chips above — admin and up — which is
                      also who may spend the group's credit on a text. Lands in
                      the composer with this person already chosen. */}
                  <Button
                    label={`Message ${member.fullName.split(' ')[0]}`}
                    size="sm"
                    variant="outline"
                    className="mt-1 self-start"
                    onPress={() =>
                      router.push({ pathname: '/messages/new', params: { memberId: member.id } })
                    }
                  />
                </View>
              )}
            </Card>
          );
        })}

        {hidden > 0 && (
          <Button
            label={`View ${hidden} more`}
            variant="outline"
            fullWidth
            onPress={() => setShowAll(true)}
          />
        )}
      </ScrollView>
    </View>
  );
}
