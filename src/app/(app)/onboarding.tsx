import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { useCurrentGroup } from '@/features/groups/current-group';
import { useCreateGroup, useJoinGroup } from '@/features/groups/use-groups';
import { useMyJoinRequests } from '@/features/groups/use-membership';
import { goBack } from '@/lib/navigation';

type Mode = 'choose' | 'create' | 'join';

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { memberships, selectGroup } = useCurrentGroup();
  const hasGroup = memberships.length > 0;
  const [mode, setMode] = useState<Mode>('choose');
  const [groupName, setGroupName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const createGroup = useCreateGroup();
  const joinGroup = useJoinGroup();
  const requests = useMyJoinRequests();

  const isBusy = createGroup.isPending || joinGroup.isPending;

  function messageFor(err: unknown) {
    return err instanceof Error ? err.message : 'Something went wrong. Try again.';
  }

  async function handleCreate() {
    setError(null);
    if (groupName.trim().length === 0) {
      setError('Give your group a name');
      return;
    }
    try {
      const group = (await createGroup.mutateAsync({ name: groupName })) as { id?: string } | null;
      // The layout no longer redirects away from here, so this screen has to
      // move itself. Selecting the new group first means the dashboard opens on
      // the one they just made rather than whichever is oldest.
      if (group?.id) selectGroup(group.id);
      router.replace('/');
    } catch (err) {
      setError(messageFor(err));
    }
  }

  async function handleJoin() {
    setError(null);
    if (joinCode.trim().length === 0) {
      setError('Enter the code your group shared with you');
      return;
    }
    try {
      const group = (await joinGroup.mutateAsync(joinCode)) as { id?: string } | null;

      // When the group vets its members this creates a REQUEST, not a
      // membership. Check before navigating: landing on a dashboard for a group
      // that has not let them in yet would be worse than the waiting screen.
      const { data: stillPending } = await requests.refetch();

      if ((stillPending ?? []).length > 0) {
        setMode('choose');
        return;
      }

      if (group?.id) selectGroup(group.id);
      router.replace('/');
    } catch (err) {
      setError(messageFor(err));
    }
  }

  // A pending request is not a group, so the layout keeps sending them here.
  // Without this they would sit on "create or join" with no idea their code
  // worked, and would very likely try it again.
  // Gated on `choose` so "join a different group instead" can fall through to
  // the form below rather than being bounced straight back here.
  const pending = requests.data ?? [];
  if (pending.length > 0 && mode === 'choose') {
    return (
      <View className="flex-1 bg-background">
        {/* The way out. Without this, someone who already belonged to a group
            and asked to join a second was trapped here: the only buttons were
            "check again" and "join another", neither of which goes home. */}
        {hasGroup && (
          <View className="flex-row px-5" style={{ paddingTop: insets.top + 8 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back to your groups"
              onPress={() => router.replace('/')}
              className="-ml-2 rounded-full p-2 active:bg-secondary">
              <ChevronLeft size={22} color="#66756F" />
            </Pressable>
          </View>
        )}

        <View
          className="flex-1 justify-center gap-4 px-6"
          style={{ paddingTop: hasGroup ? 0 : insets.top }}>
          <Text variant="display">Waiting for approval</Text>

          {pending.map((request) => (
            <Card key={request.memberId} className="gap-1">
              <Text variant="heading">{request.groupName}</Text>
              <Text variant="caption">
                You asked to join on {new Date(request.requestedAt).toLocaleDateString()}. An admin
                has to let you in before you can see the group.
              </Text>
            </Card>
          ))}

          <Button
            label="Check again"
            variant="outline"
            fullWidth
            loading={requests.isFetching}
            onPress={() => requests.refetch()}
          />
          <Button
            variant="ghost"
            label="Join a different group instead"
            onPress={() => setMode('join')}
          />
          {hasGroup && (
            <Button
              variant="ghost"
              label="Back to your groups"
              onPress={() => router.replace('/')}
            />
          )}
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-background">
      {/* Only someone who already belongs somewhere can leave — a first-time
          user has nowhere to go back to, and a close button that stranded them
          on a blank screen would be worse than none. */}
      {hasGroup && (
        <View className="flex-row px-5" style={{ paddingTop: insets.top + 8 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={() => goBack()}
            className="-ml-2 rounded-full p-2 active:bg-secondary">
            <ChevronLeft size={22} color="#66756F" />
          </Pressable>
        </View>
      )}

      <ScrollView
        contentContainerStyle={{
          paddingTop: hasGroup ? 8 : insets.top + 48,
          paddingBottom: insets.bottom + 32,
        }}
        contentContainerClassName="grow justify-center gap-8 px-6"
        keyboardShouldPersistTaps="handled">
        <View className="gap-2">
          <Text variant="display">{hasGroup ? 'Another group' : 'Welcome to Kobox'}</Text>
          <Text variant="muted">
            {mode === 'choose'
              ? hasGroup
                ? 'Start another group, or join one you have been invited to. You can switch between them any time.'
                : 'Start a group to collect contributions, or join one you have been invited to.'
              : mode === 'create'
                ? 'You will be the owner and can invite everyone else.'
                : 'Ask your group secretary for the join code.'}
          </Text>
        </View>

        {mode === 'choose' && (
          <View className="gap-3">
            <Button
              label="Create a new group"
              size="lg"
              fullWidth
              onPress={() => setMode('create')}
            />
            <Button
              label="Join an existing group"
              variant="outline"
              size="lg"
              fullWidth
              onPress={() => setMode('join')}
            />
          </View>
        )}

        {mode === 'create' && (
          <View className="gap-4">
            <Input
              label="Group name"
              value={groupName}
              onChangeText={setGroupName}
              placeholder="Adom Welfare Association"
              autoCapitalize="words"
              editable={!isBusy}
            />
            <Button
              label="Create group"
              size="lg"
              fullWidth
              loading={createGroup.isPending}
              onPress={handleCreate}
            />
            <Button label="Back" variant="ghost" onPress={() => setMode('choose')} />
          </View>
        )}

        {mode === 'join' && (
          <View className="gap-4">
            <Input
              label="Join code"
              value={joinCode}
              onChangeText={(text) => setJoinCode(text.toUpperCase())}
              placeholder="KBX-4821"
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!isBusy}
            />
            <Button
              label="Join group"
              size="lg"
              fullWidth
              loading={joinGroup.isPending}
              onPress={handleJoin}
            />
            <Button label="Back" variant="ghost" onPress={() => setMode('choose')} />
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
