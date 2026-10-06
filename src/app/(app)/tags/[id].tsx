import { useLocalSearchParams } from 'expo-router';
import { ChevronLeft, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { OptionGroup, type Option } from '@/components/ui/option-group';
import { Text } from '@/components/ui/text';
import { confirm } from '@/lib/confirm';
import { useCurrentGroup } from '@/features/groups/current-group';
import { useMembers } from '@/features/members/use-members';
import { ColourPicker } from '@/features/tags/colour-picker';
import {
  useDeleteTag,
  useRenameTag,
  useSetTagMembers,
  useTagMembers,
  useTags,
} from '@/features/tags/use-tags';
import { ROLE_RANK, type MemberRole } from '@/lib/domain';
import { goBack } from '@/lib/navigation';

type ArrearsChoice = 'from-now' | 'from-start';

const ARREARS_OPTIONS: readonly Option<ArrearsChoice>[] = [
  { value: 'from-now', label: 'No, from now on', hint: 'The open period on' },
  { value: 'from-start', label: 'Yes, include arrears', hint: 'Every period so far' },
];

export default function TagScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { membership } = useCurrentGroup();

  const tags = useTags(membership?.groupId);
  const members = useMembers(membership?.groupId);
  const tagMembers = useTagMembers(id);

  const renameTag = useRenameTag();
  const setTagMembers = useSetTagMembers();
  const deleteTag = useDeleteTag();

  const canManage =
    membership !== null && ROLE_RANK[membership.role as MemberRole] >= ROLE_RANK.treasurer;
  const tag = (tags.data ?? []).find((t) => t.id === id);

  // Each field is null until it is touched, and falls back to what the server
  // holds. Seeding state from an effect instead would let a background refetch
  // overwrite what is being typed — and React Compiler rejects it outright.
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [colourDraft, setColourDraft] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[] | null>(null);
  const [arrears, setArrears] = useState<ArrearsChoice>('from-now');
  const [error, setError] = useState<string | null>(null);

  if (tags.isPending || tagMembers.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  if (!tag) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-background px-6">
        <Text variant="heading">Tag not found</Text>
        <Button label="Go back" variant="outline" onPress={() => goBack()} />
      </View>
    );
  }

  const name = nameDraft ?? tag.name;
  const colour = colourDraft ?? tag.colour;
  const original = tagMembers.data ?? [];
  const chosen = picked ?? original;

  const added = chosen.filter((m) => !original.includes(m));
  const removed = original.filter((m) => !chosen.includes(m));
  const membersChanged = added.length > 0 || removed.length > 0;
  const detailsChanged =
    name.trim() !== tag.name || colour.toLowerCase() !== tag.colour.toLowerCase();

  // Backdating only means anything when someone is joining a tag that already
  // has a contribution behind it.
  const asksAboutArrears = added.length > 0 && tag.planCount > 0;

  function toggle(memberId: string) {
    setPicked((prev) => {
      const current = prev ?? original;
      return current.includes(memberId)
        ? current.filter((m) => m !== memberId)
        : [...current, memberId];
    });
  }

  async function handleSave() {
    setError(null);
    try {
      if (detailsChanged) {
        await renameTag.mutateAsync({ tagId: id, name: name.trim(), colour });
      }
      if (membersChanged) {
        await setTagMembers.mutateAsync({
          tagId: id,
          memberIds: chosen,
          includePastPeriods: arrears === 'from-start',
        });
      }
      goBack();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the tag. Try again.');
    }
  }

  async function confirmDelete() {
    const yes = await confirm({
      title: `Delete ${tag!.name}?`,
      message: 'The tag is removed from everyone carrying it. No payments or records are affected.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!yes) return;

    setError(null);
    try {
      await deleteTag.mutateAsync(id);
      goBack();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the tag.');
    }
  }

  return (
    <View className="flex-1 bg-background">
      <View
        className="flex-row items-center gap-2 px-5 pb-3"
        style={{ paddingTop: insets.top + 8 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => goBack()}
          className="-ml-2 rounded-full p-2 active:bg-secondary">
          <ChevronLeft size={22} color="#66756F" />
        </Pressable>
        <Text variant="title" numberOfLines={1} className="flex-1">
          {tag.name}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        contentContainerClassName="gap-6 px-5 pt-2"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        {canManage ? (
          <>
            <Input label="Name" value={name} onChangeText={setNameDraft} autoCapitalize="words" />
            <ColourPicker value={colour} onChange={setColourDraft} />
          </>
        ) : (
          <Card className="flex-row items-center gap-3">
            <View className="h-9 w-9 rounded-full" style={{ backgroundColor: tag.colour }} />
            <Text variant="heading" className="flex-1">
              {tag.name}
            </Text>
          </Card>
        )}

        {tag.planCount > 0 && (
          <Card className="gap-1 border-primary/30 bg-primary/5">
            <Text variant="label">
              {tag.planCount} {tag.planCount === 1 ? 'contribution is' : 'contributions are'} for
              this tag
            </Text>
            <Text variant="caption">
              Adding someone here starts them contributing. Taking someone out clears what they have
              not paid — anything already paid stays on the books.
            </Text>
          </Card>
        )}

        <View className="gap-2">
          <Text variant="label">
            Who carries this tag ({chosen.length} of {(members.data ?? []).length})
          </Text>

          {(members.data ?? []).map((member) => {
            const isPicked = chosen.includes(member.id);
            return (
              <Pressable
                key={member.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: isPicked, disabled: !canManage }}
                disabled={!canManage}
                onPress={() => toggle(member.id)}
                className={`flex-row items-center gap-3 rounded-lg border p-3 ${
                  isPicked ? 'border-primary bg-primary/10' : 'border-border bg-card'
                } ${canManage ? '' : 'opacity-70'}`}>
                <View
                  className={`h-6 w-6 items-center justify-center rounded-md border-2 ${
                    isPicked ? 'border-primary bg-primary' : 'border-border'
                  }`}>
                  {isPicked && (
                    <Text variant="caption" className="text-primary-foreground">
                      ✓
                    </Text>
                  )}
                </View>
                <Text variant="label" className="flex-1" numberOfLines={1}>
                  {member.fullName}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {asksAboutArrears && (
          <OptionGroup
            label={`Do the ${added.length === 1 ? 'new member' : 'new members'} owe the periods before today?`}
            options={ARREARS_OPTIONS}
            value={arrears}
            onChange={setArrears}
          />
        )}

        {error && (
          <View className="rounded-lg bg-destructive/10 p-3">
            <Text variant="caption" className="text-destructive">
              {error}
            </Text>
          </View>
        )}

        {canManage && (
          <>
            <Button
              label="Save changes"
              size="lg"
              fullWidth
              disabled={!detailsChanged && !membersChanged}
              loading={renameTag.isPending || setTagMembers.isPending}
              onPress={handleSave}
            />

            <Button
              label="Delete this tag"
              variant="ghost"
              icon={<Trash2 size={16} color="#D14343" />}
              loading={deleteTag.isPending}
              onPress={confirmDelete}
            />
          </>
        )}
      </ScrollView>
    </View>
  );
}
