import { useQuery, useQueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import {
  Bell,
  Building2,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  Moon,
  PenLine,
  Smartphone,
  Sun,
  UserRound,
} from 'lucide-react-native';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { useBrand } from '@/features/groups/brand';
import { useCurrentGroup } from '@/features/groups/current-group';
import { loadAppearance, saveAppearance, type AppearanceMode } from '@/lib/appearance';
import { ROLE_RANK, type MemberRole } from '@/lib/domain';

const APPEARANCE: { mode: AppearanceMode; label: string; icon: typeof Sun }[] = [
  { mode: 'system', label: 'Phone', icon: Smartphone },
  { mode: 'light', label: 'Light', icon: Sun },
  { mode: 'dark', label: 'Dark', icon: Moon },
];

interface RowProps {
  icon: typeof Sun;
  label: string;
  hint?: string;
  first?: boolean;
  onPress: () => void;
}

function Row({ icon: Icon, label, hint, first, onPress }: RowProps) {
  const brand = useBrand();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className={`flex-row items-center gap-3 p-4 active:bg-secondary ${
        first ? '' : 'border-t border-border'
      }`}>
      <Icon size={18} color={brand.hex} />
      <View className="flex-1">
        <Text variant="label">{label}</Text>
        {hint && <Text variant="caption">{hint}</Text>}
      </View>
      <ChevronRight size={18} color="#9AA8A3" />
    </Pressable>
  );
}

/**
 * Settings, split by whose they are.
 *
 * "This group" changes what every member sees and is for admins. "You" is the
 * person holding the phone — their own name, their own reminders, and how the
 * app looks on this device — and is for everybody. Mixing the two in one list
 * is how a member ends up believing they changed the group's name.
 */
export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const brand = useBrand();
  const queryClient = useQueryClient();
  const { membership } = useCurrentGroup();

  const isAdmin =
    membership !== null && ROLE_RANK[membership.role as MemberRole] >= ROLE_RANK.admin;

  // A query rather than an effect: AsyncStorage is async and React Compiler
  // rejects seeding state from an effect. Saving writes straight back into it.
  const appearance = useQuery({
    queryKey: ['appearance'],
    queryFn: loadAppearance,
    staleTime: Infinity,
  });

  function chooseAppearance(mode: AppearanceMode) {
    queryClient.setQueryData(['appearance'], mode);
    saveAppearance(mode);
  }

  const version = Constants.expoConfig?.version ?? '1.0.0';

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
        <Text variant="title">Settings</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        contentContainerClassName="gap-5 px-5 pt-2"
        showsVerticalScrollIndicator={false}>
        {isAdmin && membership && (
          <View className="gap-2">
            <Text variant="label" className="text-muted-foreground">
              This group
            </Text>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Edit the group's details"
              onPress={() => router.push('/settings/group')}
              className="active:opacity-70">
              <Card className="flex-row items-center gap-3">
                <Avatar name={membership.groupName} uri={membership.logoUrl} size="lg" />
                <View className="flex-1">
                  <Text variant="heading" numberOfLines={1}>
                    {membership.groupName}
                  </Text>
                </View>
                <PenLine size={18} color={brand.hex} />
              </Card>
            </Pressable>

            <Card className="gap-0 p-0">
              <Row
                first
                icon={MessageSquare}
                label="Messages"
                onPress={() => router.push('/messages')}
              />
              <Row icon={Building2} label="Text messages" onPress={() => router.push('/sms')} />
            </Card>
          </View>
        )}

        <View className="gap-2">
          <Text variant="label" className="text-muted-foreground">
            You
          </Text>
          <Card className="gap-0 p-0">
            <Row first icon={UserRound} label="Profile" onPress={() => router.push('/profile')} />
            <Row icon={Bell} label="Reminders" onPress={() => router.push('/reminders')} />
          </Card>
        </View>

        <View className="gap-2">
          <Text variant="label" className="text-muted-foreground">
            Appearance
          </Text>
          <Card className="flex-row gap-2 p-2">
            {APPEARANCE.map(({ mode, label, icon: Icon }) => {
              const selected = (appearance.data ?? 'system') === mode;
              return (
                <Pressable
                  key={mode}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={mode === 'system' ? 'Follow the phone' : `${label} mode`}
                  onPress={() => chooseAppearance(mode)}
                  className={`flex-1 items-center gap-1 rounded-lg py-3 ${
                    selected ? 'bg-primary/10' : 'active:bg-secondary'
                  }`}>
                  <Icon size={18} color={selected ? brand.hex : '#9AA8A3'} />
                  <Text variant="caption" className={selected ? 'font-semibold text-primary' : ''}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </Card>
        </View>

        <Text variant="caption" className="text-center">
          Kobox {version} · FMT Software Solutions
        </Text>
      </ScrollView>
    </View>
  );
}
