import { useRouter } from 'expo-router';
import { BadgeCheck, ChevronLeft, Clock, Trash2, TriangleAlert } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { useBrand } from '@/features/groups/brand';
import { useCurrentGroup } from '@/features/groups/current-group';
import type { SenderIdRequest } from '@/features/sms/api';
import {
  useRequestSenderId,
  useSenderIdRequests,
  useSmsBalance,
  useWithdrawSenderIdRequest,
} from '@/features/sms/use-sms';
import { ROLE_RANK, type MemberRole } from '@/lib/domain';

/** Arkesel's hard limit, and the reason the field stops at eleven characters. */
const MAX_LENGTH = 11;

function statusBadge(status: SenderIdRequest['status']) {
  if (status === 'approved') return <Badge label="Approved" tone="success" />;
  if (status === 'rejected') return <Badge label="Not approved" tone="danger" />;
  return <Badge label="Waiting" tone="warning" />;
}

/**
 * The name a group's messages arrive from.
 *
 * Every group sends as `Kobox` until it asks for something else, and most never
 * will. A sender ID has to be registered with the mobile networks — a human
 * process at Arkesel measured in days — so this screen files a REQUEST. Nothing
 * here can approve it, and that is enforced by the database rather than by the
 * UI: an admin who could approve their own request could send messages signed
 * as any name they liked.
 */
export default function SenderIdScreen() {
  const brand = useBrand();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { membership } = useCurrentGroup();

  const isAdmin =
    membership !== null && ROLE_RANK[membership.role as MemberRole] >= ROLE_RANK.admin;
  const groupId = isAdmin ? membership?.groupId : undefined;

  const requests = useSenderIdRequests(groupId);
  const balance = useSmsBalance(groupId);
  const request = useRequestSenderId();
  const withdraw = useWithdrawSenderIdRequest();

  const [senderId, setSenderId] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const active = balance.data?.senderId ?? null;
  const list = requests.data ?? [];
  // Rejected requests do not count — a refusal that permanently used up a slot
  // would be a refusal nobody could recover from.
  const slotsUsed = list.filter((item) => item.status !== 'rejected').length;
  const atLimit = slotsUsed >= 3;

  function submit() {
    if (!membership) return;
    setError(null);

    const trimmed = senderId.trim();

    // Arkesel rejects a sender ID with a space or punctuation outright, and it
    // does so silently at send time rather than at registration — so the check
    // belongs here, where somebody can still fix it.
    if (!/^[A-Za-z0-9]{3,11}$/.test(trimmed)) {
      setError('Use 3 to 11 letters or numbers, with no spaces or punctuation.');
      return;
    }
    if (reason.trim().length < 10) {
      setError('Say a little more about who the group is — the networks ask for it.');
      return;
    }

    request.mutate(
      {
        groupId: membership.groupId,
        groupName: membership.groupName,
        senderId: trimmed,
        reason: reason.trim(),
      },
      {
        onSuccess: () => {
          setSenderId('');
          setReason('');
        },
        onError: (err) => setError(err instanceof Error ? err.message : 'Could not send that.'),
      }
    );
  }

  if (!isAdmin) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-8">
        <Text variant="caption" className="text-center">
          Only an admin can change the name this group&rsquo;s messages come from.
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <View
        className="flex-row items-center gap-2 px-5 pb-3"
        style={{ paddingTop: insets.top + 8 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => router.back()}
          className="-ml-2 rounded-full p-2 active:bg-secondary">
          <ChevronLeft size={22} color="#66756F" />
        </Pressable>
        <Text variant="title">Sender ID</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        contentContainerClassName="gap-4 px-5 pt-2"
        showsVerticalScrollIndicator={false}>
        <Card className="gap-1">
          <Text variant="caption">Current</Text>
          <Text variant="heading">{active ?? 'Kobox'}</Text>
        </Card>

        {/* ------------------------------------------------------ requests -- */}
        {requests.isPending ? (
          <Card>
            <ActivityIndicator />
          </Card>
        ) : (
          list.length > 0 && (
            <View className="gap-2">
              <Text variant="label">Your requests</Text>
              <Card className="gap-0 p-0">
                {list.map((item, index) => (
                  <View
                    key={item.id}
                    className={`gap-2 p-4 ${index > 0 ? 'border-t border-border' : ''}`}>
                    <View className="flex-row items-center gap-2">
                      {item.status === 'approved' ? (
                        <BadgeCheck size={16} color={brand.hex} />
                      ) : item.status === 'rejected' ? (
                        <TriangleAlert size={16} color="#D14343" />
                      ) : (
                        <Clock size={16} color="#B26B00" />
                      )}
                      <Text variant="label" className="flex-1">
                        {item.senderId}
                      </Text>
                      {statusBadge(item.status)}
                    </View>

                    {item.status === 'rejected' && item.rejectionReason && (
                      <Text variant="caption" className="text-destructive">
                        {item.rejectionReason}
                      </Text>
                    )}

                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Withdraw the request for ${item.senderId}`}
                      disabled={withdraw.isPending}
                      onPress={() => withdraw.mutate(item.id)}
                      className="flex-row items-center gap-1.5 self-start active:opacity-60">
                      <Trash2 size={14} color="#9AA8A3" />
                      <Text variant="caption">Withdraw</Text>
                    </Pressable>
                  </View>
                ))}
              </Card>
            </View>
          )
        )}

        {/* --------------------------------------------------- new request -- */}
        {atLimit ? (
          <Card>
            <Text variant="label">Limit of 3 reached</Text>
          </Card>
        ) : (
          <View className="gap-2">
            <Text variant="label">Request a sender ID</Text>
            <Card className="gap-3">
              <Input
                label="Sender ID"
                value={senderId}
                onChangeText={(text) => setSenderId(text.slice(0, MAX_LENGTH))}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={MAX_LENGTH}
                placeholder="e.g. AkosuaSusu"
              />
              <Text variant="caption" className="text-right">
                {senderId.length}/{MAX_LENGTH}
              </Text>

              <Input
                label="Who is this group?"
                value={reason}
                onChangeText={setReason}
                multiline
                numberOfLines={3}
                placeholder="About your group"
                className="min-h-24"
                textAlignVertical="top"
              />

              {error && (
                <Text variant="caption" className="text-destructive">
                  {error}
                </Text>
              )}

              <Button label="Send request" fullWidth loading={request.isPending} onPress={submit} />
            </Card>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
