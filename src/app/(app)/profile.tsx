import * as ImagePicker from 'expo-image-picker';
import { Camera, ChevronLeft, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { useSession } from '@/features/auth/session-provider';
import { useBrand } from '@/features/groups/brand';
import {
  useClearMyAvatar,
  useMyProfile,
  useSetMyName,
  useUploadMyAvatar,
} from '@/features/profile/use-profile';
import { formatGhanaPhone } from '@/lib/phone';
import { goBack } from '@/lib/navigation';

/**
 * Your own name and picture.
 *
 * Nothing wrote to `profiles` before this screen existed, which is why a phone
 * user showed up as "Member" everywhere — see `set_my_name`, which repairs that
 * placeholder on the way through.
 */
export default function ProfileScreen() {
  const brand = useBrand();
  const insets = useSafeAreaInsets();
  const { session } = useSession();

  const profile = useMyProfile();
  const setName = useSetMyName();
  const uploadAvatar = useUploadMyAvatar();
  const clearAvatar = useClearMyAvatar();

  // Held as null until touched, falling back to the server value. React
  // Compiler forbids seeding state from an effect, and it fixes the real bug
  // too: a background refetch can no longer overwrite what is being typed.
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (profile.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  const data = profile.data;
  const name = nameDraft ?? data?.fullName ?? '';
  const isBusy = setName.isPending || uploadAvatar.isPending || clearAvatar.isPending;

  async function pickAvatar() {
    setError(null);
    setNotice(null);

    // Asked for at the moment it is needed, rather than at launch — a
    // permission prompt with no visible cause is the one people decline.
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Kobox needs access to your photos to set a picture.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      // The crop UI. A square is the only shape an avatar is ever shown in, so
      // cropping to it here beats letting the component centre-crop later.
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });

    if (result.canceled) return;

    const picked = result.assets[0];
    if (!picked) return;

    try {
      await uploadAvatar.mutateAsync(picked.uri);
      setNotice('Picture updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload that picture.');
    }
  }

  async function saveName() {
    setError(null);
    setNotice(null);

    if (name.trim() === '') {
      setError('Enter your name.');
      return;
    }

    try {
      await setName.mutateAsync(name.trim());
      setNameDraft(null);
      setNotice('Name saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your name.');
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-background">
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
          Your profile
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        contentContainerClassName="gap-4 px-5 pt-2"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <Card className="items-center gap-3">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Change your picture"
            disabled={isBusy}
            onPress={pickAvatar}
            className="active:opacity-70">
            <Avatar name={name || 'You'} uri={data?.avatarUrl} size="lg" />
          </Pressable>

          {uploadAvatar.isPending ? (
            <ActivityIndicator />
          ) : (
            <View className="flex-row gap-2">
              <Button
                label={data?.avatarUrl ? 'Change picture' : 'Add a picture'}
                size="sm"
                variant="outline"
                icon={<Camera size={16} color={brand.deep} />}
                disabled={isBusy}
                onPress={pickAvatar}
              />
              {data?.avatarUrl && (
                <Button
                  label="Remove"
                  size="sm"
                  variant="ghost"
                  icon={<Trash2 size={16} color="#D14343" />}
                  disabled={isBusy}
                  onPress={() => clearAvatar.mutate()}
                />
              )}
            </View>
          )}

          <Text variant="caption" className="text-center">
            Pictures are resized before they are saved, so they stay quick to load.
          </Text>
        </Card>

        <Card className="gap-3">
          <Input
            label="Your name"
            value={name}
            onChangeText={setNameDraft}
            autoCapitalize="words"
            autoComplete="name"
            textContentType="name"
            placeholder="Ama Serwaa Boateng"
          />
          <Text variant="caption">
            This is how you appear to your groups. A name a treasurer already gave you is left as it
            is.
          </Text>
          <Button
            label="Save name"
            fullWidth
            loading={setName.isPending}
            disabled={isBusy || name.trim() === '' || name.trim() === data?.fullName}
            onPress={saveName}
          />
        </Card>

        {/* How you sign in — read-only. Changing either is a security action
            with its own verification, not a profile edit. */}
        <Card className="gap-1">
          <Text variant="label">How you sign in</Text>
          {data?.phone && <Text variant="caption">{formatGhanaPhone(data.phone)}</Text>}
          {session?.user.email && <Text variant="caption">{session.user.email}</Text>}
        </Card>

        {notice && (
          <View className="rounded-lg bg-success/10 p-3">
            <Text variant="caption" className="text-success">
              {notice}
            </Text>
          </View>
        )}

        {error && (
          <View className="rounded-lg bg-destructive/10 p-3">
            <Text variant="caption" className="text-destructive">
              {error}
            </Text>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
