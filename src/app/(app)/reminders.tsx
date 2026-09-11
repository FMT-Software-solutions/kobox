import { useRouter } from 'expo-router';
import { Check, ChevronLeft, ChevronRight, MessageSquare } from 'lucide-react-native';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { useBrand } from '@/features/groups/brand';
import { useCurrentGroup } from '@/features/groups/current-group';
import type { NotificationPreferences } from '@/features/notifications/api';
import { usePreferences, useSavePreferences } from '@/features/notifications/use-notifications';
import { useSmsBalance } from '@/features/sms/use-sms';
import { ROLE_RANK, type MemberRole } from '@/lib/domain';

interface ToggleProps {
  label: string;
  hint?: string;
  value: boolean;
  disabled?: boolean;
  onPress: () => void;
}

function Toggle({ label, hint, value, disabled, onPress }: ToggleProps) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled: Boolean(disabled) }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      className={`flex-row items-center gap-3 p-4 ${disabled ? 'opacity-50' : 'active:bg-secondary'}`}>
      <View
        className={`h-5 w-5 items-center justify-center rounded border ${
          value ? 'border-primary bg-primary' : 'border-border'
        }`}>
        {value && <Check size={14} color="white" />}
      </View>
      <View className="flex-1">
        <Text variant="label">{label}</Text>
        {hint ? <Text variant="caption">{hint}</Text> : null}
      </View>
    </Pressable>
  );
}

/**
 * What this group is allowed to send you.
 *
 * Preferences are per MEMBER rather than per account: somebody may want every
 * reminder from the group collecting their rent and none from the old students'
 * association.
 */
export default function RemindersScreen() {
  const brand = useBrand();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { membership } = useCurrentGroup();

  const preferences = usePreferences(membership?.memberId);
  const save = useSavePreferences();

  const isAdmin =
    membership !== null && ROLE_RANK[membership.role as MemberRole] >= ROLE_RANK.admin;
  const balance = useSmsBalance(isAdmin ? membership?.groupId : undefined);

  const current = preferences.data;

  function update(patch: Partial<NotificationPreferences>) {
    if (!membership || !current) return;
    save.mutate({ memberId: membership.memberId, preferences: { ...current, ...patch } });
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
        <Text variant="title">Reminders</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        contentContainerClassName="gap-4 px-5 pt-2"
        showsVerticalScrollIndicator={false}>
        {preferences.isPending || !current ? (
          <Card>
            <ActivityIndicator />
          </Card>
        ) : (
          <>
            <Card className="gap-0 p-0">
              <Toggle
                label="Push notifications"
                value={current.pushEnabled}
                onPress={() => update({ pushEnabled: !current.pushEnabled })}
              />
              <View className="border-t border-border">
                <Toggle
                  label="Text messages"
                  value={current.smsEnabled}
                  onPress={() => update({ smsEnabled: !current.smsEnabled })}
                />
              </View>
              <View className="border-t border-border">
                <Toggle
                  label="Payment reminders"
                  value={current.remindersEnabled}
                  onPress={() => update({ remindersEnabled: !current.remindersEnabled })}
                />
              </View>
            </Card>

            {/* An admin's own preferences are one thing; what the group can
                afford to send is another, and it belongs on its own screen
                beside the money. This is the pointer, not the controls. */}
            {isAdmin && (
              <View className="gap-2">
                <Text variant="label">Text messages for this group</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Manage text message credits"
                  onPress={() => router.push('/sms')}
                  className="active:opacity-70">
                  <Card className="flex-row items-center gap-3">
                    <MessageSquare
                      size={18}
                      color={balance.data?.credits ? brand.hex : '#B26B00'}
                    />
                    <View className="flex-1">
                      <Text variant="label">
                        {balance.isPending
                          ? 'Checking credits…'
                          : balance.data?.credits
                            ? `${balance.data.credits.toLocaleString()} credits left`
                            : 'No credits'}
                      </Text>
                      {Boolean(balance.data?.credits) && (
                        <Text variant="caption">
                          {balance.data!.usedThisMonth} of {balance.data!.monthlyCap} used this
                          month
                        </Text>
                      )}
                    </View>
                    <ChevronRight size={18} color="#9AA8A3" />
                  </Card>
                </Pressable>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}
