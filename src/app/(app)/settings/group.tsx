import * as ImagePicker from 'expo-image-picker';
import { Camera, Check, ChevronLeft, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { useBrand } from '@/features/groups/brand';
import { useCurrentGroup } from '@/features/groups/current-group';
import { DESCRIPTION_LIMIT, NAME_LIMIT } from '@/features/groups/settings-api';
import {
  useClearGroupLogo,
  useGroupProfile,
  useUpdateGroupProfile,
  useUploadGroupLogo,
} from '@/features/groups/use-settings';
import { BRAND_PRESETS, DEFAULT_BRAND, type BrandKey } from '@/lib/brand';
import { ROLE_RANK, type MemberRole } from '@/lib/domain';
import { goBack } from '@/lib/navigation';

/**
 * Who the group is, and what it looks like.
 *
 * The brand colour saves the moment it is tapped: the whole app re-colours at
 * once, and seeing it is the only way to judge it. Name and description wait
 * for Save, because a half-typed name should not appear on every member's
 * dashboard.
 *
 * Currency is shown and deliberately NOT editable. Every amount is stored in
 * minor units with no currency of its own, so changing GHS to USD would
 * relabel every contribution ever recorded. The database refuses it too.
 */
export default function GroupSettingsScreen() {
  const insets = useSafeAreaInsets();
  const brand = useBrand();
  const { membership } = useCurrentGroup();

  const isAdmin =
    membership !== null && ROLE_RANK[membership.role as MemberRole] >= ROLE_RANK.admin;
  const groupId = isAdmin ? membership?.groupId : undefined;

  const profile = useGroupProfile(groupId);
  const update = useUpdateGroupProfile();
  const upload = useUploadGroupLogo();
  const clear = useClearGroupLogo();

  // Drafts are null until touched, so the fields show the saved values without
  // copying them into state from an effect.
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [descriptionDraft, setDescriptionDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const data = profile.data;
  const name = nameDraft ?? data?.name ?? '';
  const description = descriptionDraft ?? data?.description ?? '';
  const dirty =
    (nameDraft !== null && nameDraft.trim() !== data?.name) ||
    (descriptionDraft !== null && descriptionDraft.trim() !== (data?.description ?? ''));

  async function pickLogo() {
    if (!groupId) return;
    setError(null);
    setNotice(null);

    // Asked at the moment it is needed — a prompt with no visible cause is the
    // one people decline.
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Kobox needs access to your photos to set a logo.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });
    if (result.canceled || !result.assets[0]) return;

    try {
      await upload.mutateAsync({ groupId, localUri: result.assets[0].uri });
      setNotice('Logo updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload that logo.');
    }
  }

  async function removeLogo() {
    if (!groupId) return;
    setError(null);
    setNotice(null);
    try {
      await clear.mutateAsync(groupId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the logo.');
    }
  }

  async function chooseColour(key: BrandKey) {
    if (!groupId) return;
    setError(null);
    try {
      // Stored as NULL for the default, so a future change of default reaches
      // every group that never picked one.
      await update.mutateAsync({ groupId, brandColour: key === DEFAULT_BRAND ? null : key });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the colour.');
    }
  }

  async function saveDetails() {
    if (!groupId) return;
    setError(null);
    setNotice(null);

    if (name.trim() === '') {
      setError('The group needs a name.');
      return;
    }

    try {
      await update.mutateAsync({ groupId, name, description });
      setNameDraft(null);
      setDescriptionDraft(null);
      setNotice('Saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save those details.');
    }
  }

  if (!isAdmin) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-8">
        <Text variant="caption" className="text-center">
          Only an admin can change the group&rsquo;s details.
        </Text>
      </View>
    );
  }

  const selectedColour = data?.brandColour ?? DEFAULT_BRAND;
  const logoBusy = upload.isPending || clear.isPending;

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
        <Text variant="title">Group details</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        contentContainerClassName="gap-5 px-5 pt-2"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        {profile.isPending || !data ? (
          <Card>
            <ActivityIndicator />
          </Card>
        ) : (
          <>
            {/* ------------------------------------------------------ logo -- */}
            <Card className="items-center gap-3 py-6">
              <View className="h-24 w-24 items-center justify-center">
                <Avatar name={data.name} uri={data.logoUrl} size="lg" className="h-24 w-24" />
                {logoBusy && (
                  <View className="absolute inset-0 items-center justify-center rounded-full bg-black/30">
                    <ActivityIndicator color="white" />
                  </View>
                )}
              </View>
              <View className="flex-row gap-2">
                <Button
                  label={data.logoUrl ? 'Change logo' : 'Add a logo'}
                  size="sm"
                  variant="outline"
                  disabled={logoBusy}
                  icon={<Camera size={16} color={brand.deep} />}
                  onPress={pickLogo}
                />
                {!!data.logoUrl && (
                  <Button
                    label="Remove"
                    size="sm"
                    variant="ghost"
                    disabled={logoBusy}
                    icon={<Trash2 size={16} color="#D14343" />}
                    onPress={removeLogo}
                  />
                )}
              </View>
            </Card>

            {/* --------------------------------------------------- details -- */}
            <Card className="gap-4">
              <Input
                label="Name"
                value={name}
                onChangeText={(text) => setNameDraft(text.slice(0, NAME_LIMIT))}
                maxLength={NAME_LIMIT}
                autoCapitalize="words"
              />

              <View className="gap-1.5">
                <Input
                  label="About the group"
                  value={description}
                  onChangeText={(text) => setDescriptionDraft(text.slice(0, DESCRIPTION_LIMIT))}
                  maxLength={DESCRIPTION_LIMIT}
                  multiline
                  textAlignVertical="top"
                  placeholder="Who you are and what you collect for."
                  className="min-h-24"
                />
                <Text variant="caption" className="text-right">
                  {description.length}/{DESCRIPTION_LIMIT}
                </Text>
              </View>

              <View className="flex-row items-center justify-between">
                <Text variant="caption">Currency</Text>
                <Text variant="label">{data.currency}</Text>
              </View>

              <Button
                label="Save"
                fullWidth
                disabled={!dirty}
                loading={update.isPending && dirty}
                onPress={saveDetails}
              />
            </Card>

            {/* ---------------------------------------------------- colour -- */}
            <View className="gap-2">
              <Text variant="label">Colour</Text>
              <Card className="gap-3">
                <View className="flex-row flex-wrap justify-between gap-y-3">
                  {BRAND_PRESETS.map((preset) => {
                    const selected = preset.key === selectedColour;
                    return (
                      <Pressable
                        key={preset.key}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        accessibilityLabel={preset.label}
                        disabled={update.isPending}
                        onPress={() => chooseColour(preset.key)}
                        className="w-[23%] items-center gap-1.5">
                        <View
                          className={`h-11 w-11 items-center justify-center rounded-full ${
                            selected ? 'border-2 border-foreground' : ''
                          }`}>
                          <View
                            className="h-9 w-9 items-center justify-center rounded-full"
                            style={{ backgroundColor: preset.hex }}>
                            {selected && <Check size={16} color="white" />}
                          </View>
                        </View>
                        <Text variant="caption">{preset.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </Card>
            </View>

            {error && (
              <View className="rounded-lg bg-destructive/10 p-3">
                <Text variant="caption" className="text-destructive">
                  {error}
                </Text>
              </View>
            )}
            {notice && (
              <View className="rounded-lg bg-success/10 p-3">
                <Text variant="caption" className="text-success">
                  {notice}
                </Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}
