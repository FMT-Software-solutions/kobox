import { useRouter } from 'expo-router';
import { ChevronLeft, ChevronRight, Plus, Tags as TagsIcon } from 'lucide-react-native';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/shared/empty-state';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { useBrand } from '@/features/groups/brand';
import { useCurrentGroup } from '@/features/groups/current-group';
import { useTags } from '@/features/tags/use-tags';
import { ROLE_RANK, type MemberRole } from '@/lib/domain';

/**
 * Tags are sub-groups: Executives, Committee, Youth. A contribution can be
 * pointed at one, and then only those members are billed for it.
 *
 * "Group" already means the organisation in Kobox, which is why these are Tags.
 */
export default function TagsScreen() {
  const brand = useBrand();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { membership } = useCurrentGroup();

  const tags = useTags(membership?.groupId);
  const canManage =
    membership !== null && ROLE_RANK[membership.role as MemberRole] >= ROLE_RANK.treasurer;

  const rows = tags.data ?? [];

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
          Tags
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        contentContainerClassName="gap-3 px-5 pt-2"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={tags.isFetching} onRefresh={() => tags.refetch()} />
        }>
        {tags.isPending && (
          <Card>
            <ActivityIndicator />
          </Card>
        )}

        {!tags.isPending && rows.length === 0 && (
          <EmptyState
            icon={<TagsIcon size={28} color="#9AA8A3" />}
            title="No tags yet"
            description={
              canManage
                ? 'Create a tag such as Executives, then point a contribution at it so only those members are billed.'
                : 'An admin can group members into tags such as Executives or Committee.'
            }
          />
        )}

        {rows.map((tag) => (
          <Pressable
            key={tag.id}
            accessibilityRole="button"
            accessibilityLabel={`Open ${tag.name}`}
            onPress={() => router.push({ pathname: '/tags/[id]', params: { id: tag.id } })}
            className="active:opacity-70">
            <Card className="flex-row items-center gap-3">
              <View
                className="h-9 w-9 rounded-full"
                style={{ backgroundColor: tag.colour }}
                accessibilityElementsHidden
              />
              <View className="flex-1">
                <Text variant="label" numberOfLines={1}>
                  {tag.name}
                </Text>
                <Text variant="caption">
                  {tag.memberCount} {tag.memberCount === 1 ? 'member' : 'members'}
                  {tag.planCount > 0
                    ? ` · ${tag.planCount} ${
                        tag.planCount === 1 ? 'contribution' : 'contributions'
                      }`
                    : ''}
                </Text>
              </View>
              <ChevronRight size={18} color="#9AA8A3" />
            </Card>
          </Pressable>
        ))}

        {canManage && (
          <Button
            label="New tag"
            variant={rows.length === 0 ? 'primary' : 'outline'}
            fullWidth
            icon={<Plus size={18} color={rows.length === 0 ? 'white' : brand.deep} />}
            onPress={() => router.push('/tags/new')}
          />
        )}
      </ScrollView>
    </View>
  );
}
