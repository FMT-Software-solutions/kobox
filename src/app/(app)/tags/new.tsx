import { X } from 'lucide-react-native';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { useCurrentGroup } from '@/features/groups/current-group';
import { DEFAULT_TAG_COLOUR } from '@/features/tags/api';
import { ColourPicker } from '@/features/tags/colour-picker';
import { useCreateTag } from '@/features/tags/use-tags';
import { goBack } from '@/lib/navigation';

export default function NewTagScreen() {
  const insets = useSafeAreaInsets();
  const { membership } = useCurrentGroup();
  const createTag = useCreateTag();

  const [name, setName] = useState('');
  const [colour, setColour] = useState<string>(DEFAULT_TAG_COLOUR);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);

    if (name.trim().length === 0) {
      setError('Give the tag a name');
      return;
    }
    if (!membership) return;

    try {
      await createTag.mutateAsync({ groupId: membership.groupId, name: name.trim(), colour });
      goBack();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the tag. Try again.');
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-background">
      <View
        className="flex-row items-center justify-between px-5 pb-3"
        style={{ paddingTop: insets.top + 8 }}>
        <Text variant="title">New tag</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={() => goBack()}
          className="rounded-full bg-secondary p-2">
          <X size={18} color="#66756F" />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        contentContainerClassName="gap-6 px-5 pt-2"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <Input
          label="Name"
          value={name}
          onChangeText={setName}
          placeholder="Executives"
          autoCapitalize="words"
          autoFocus
        />

        <ColourPicker value={colour} onChange={setColour} />

        <Text variant="caption">
          You choose who carries this tag on the next screen. A contribution pointed at a tag bills
          only those members.
        </Text>

        {error && (
          <View className="rounded-lg bg-destructive/10 p-3">
            <Text variant="caption" className="text-destructive">
              {error}
            </Text>
          </View>
        )}

        <Button
          label="Create tag"
          size="lg"
          fullWidth
          loading={createTag.isPending}
          onPress={handleSubmit}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
