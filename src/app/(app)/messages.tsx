import { useRouter } from 'expo-router';
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  MessageSquare,
  PenLine,
  TriangleAlert,
} from 'lucide-react-native';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { useBrand } from '@/features/groups/brand';
import { useCurrentGroup } from '@/features/groups/current-group';
import type { MessageHistoryRow } from '@/features/messages/api';
import { useMessageHistory } from '@/features/messages/use-messages';
import { useSmsBalance } from '@/features/sms/use-sms';
import { ROLE_RANK, type MemberRole } from '@/lib/domain';

function audienceLabel(row: MessageHistoryRow): string {
  if (row.audience === 'everyone') return 'Everyone';
  if (row.audience === 'tag') return row.tagName ?? 'A tag';
  return row.recipients === 1 ? '1 person' : `${row.recipients} people`;
}

/** One line a treasurer can read at a glance: who it reached, and how. */
function reachLine(row: MessageHistoryRow): string {
  const parts: string[] = [];
  if (!row.pushOnly && row.texted > 0) {
    parts.push(
      row.delivered > 0
        ? `${row.texted} texted, ${row.delivered} delivered`
        : `${row.texted} texted`
    );
  }
  if (row.pushed > 0) parts.push(`${row.pushed} by push`);
  if (parts.length === 0 && row.waiting === 0) return 'Nobody could be reached';
  return parts.join(' · ');
}

function MessageRow({ row, first }: { row: MessageHistoryRow; first: boolean }) {
  return (
    <View className={`gap-1.5 p-4 ${first ? '' : 'border-t border-border'}`}>
      <View className="flex-row items-center justify-between gap-2">
        <Text variant="label" className="shrink" numberOfLines={1}>
          {audienceLabel(row)}
        </Text>
        <Text variant="caption">
          {new Date(row.createdAt).toLocaleDateString(undefined, {
            day: 'numeric',
            month: 'short',
          })}
        </Text>
      </View>

      <Text numberOfLines={3}>{row.body}</Text>

      <Text variant="caption">
        {reachLine(row)}
        {row.sentBy ? ` · by ${row.sentBy}` : ''}
      </Text>

      {row.waiting > 0 && (
        <View className="flex-row items-center gap-1.5">
          <Clock size={12} color="#B26B00" />
          <Text variant="caption">Sending to {row.waiting}…</Text>
        </View>
      )}

      {row.notTexted > 0 && (
        <View className="flex-row items-center gap-1.5">
          <TriangleAlert size={12} color="#B26B00" />
          <Text variant="caption">{row.notTexted} not texted</Text>
        </View>
      )}
    </View>
  );
}

/**
 * Messages — what this group has said to its members, and a way to say more.
 *
 * Admin and up, because every text costs the group's credit. The history is
 * the record of that spend as much as of the words: it answers "did the
 * meeting notice actually reach people?" with numbers, not a hopeful tick.
 */
export default function MessagesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const brand = useBrand();
  const { membership } = useCurrentGroup();

  const isAdmin =
    membership !== null && ROLE_RANK[membership.role as MemberRole] >= ROLE_RANK.admin;
  const groupId = isAdmin ? membership?.groupId : undefined;

  const history = useMessageHistory(groupId);
  const balance = useSmsBalance(groupId);
  const rows = history.data ?? [];

  if (!isAdmin) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-8">
        <Text variant="caption" className="text-center">
          Only an admin can message the group.
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
        <Text variant="title" className="flex-1">
          Messages
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        contentContainerClassName="gap-4 px-5 pt-2"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={history.isRefetching}
            onRefresh={() => {
              history.refetch();
              balance.refetch();
            }}
          />
        }>
        <Button
          label="New message"
          fullWidth
          icon={<PenLine size={18} color="white" />}
          onPress={() => router.push('/messages/new')}
        />

        {/* Credit is what decides whether a message goes by text, so it sits
            where the decision is made rather than a screen away. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Text message credits"
          onPress={() => router.push('/sms')}
          className="active:opacity-70">
          <Card className="flex-row items-center gap-3">
            <MessageSquare size={18} color={balance.data?.credits ? brand.hex : '#B26B00'} />
            <Text variant="label" className="flex-1">
              {balance.isPending
                ? 'Checking credits…'
                : `${(balance.data?.credits ?? 0).toLocaleString()} text credits`}
            </Text>
            <ChevronRight size={18} color="#9AA8A3" />
          </Card>
        </Pressable>

        {history.isPending ? (
          <Card>
            <ActivityIndicator />
          </Card>
        ) : history.error ? (
          <Card>
            <Text variant="caption" className="text-destructive">
              {history.error.message}
            </Text>
          </Card>
        ) : rows.length === 0 ? (
          <Card className="items-center gap-2 py-8">
            <MessageSquare size={28} color="#9AA8A3" />
            <Text variant="label">No messages yet</Text>
          </Card>
        ) : (
          <View className="gap-2">
            <Text variant="label">Sent</Text>
            <Card className="gap-0 p-0">
              {rows.map((row, index) => (
                <MessageRow key={row.id} row={row} first={index === 0} />
              ))}
            </Card>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
