import { useRouter } from 'expo-router';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Clock,
  Gift,
  Signature,
  TriangleAlert,
  Wallet,
} from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { useSession } from '@/features/auth/session-provider';
import { useBrand } from '@/features/groups/brand';
import { useCurrentGroup } from '@/features/groups/current-group';
import { PURCHASE_AMOUNTS, creditsFor, type SmsTransaction } from '@/features/sms/api';
import {
  useCreditPurchase,
  useSetMonthlyCap,
  useSetSmsEnabled,
  useSmsBalance,
  useSmsTransactions,
} from '@/features/sms/use-sms';
import { ROLE_RANK, type MemberRole } from '@/lib/domain';

function LedgerRow({ entry, first }: { entry: SmsTransaction; first: boolean }) {
  const brand = useBrand();
  const isCredit = entry.amount > 0;
  const Icon = entry.type === 'bonus' ? Gift : isCredit ? ArrowDownLeft : ArrowUpRight;

  return (
    <View className={`flex-row items-center gap-3 p-4 ${first ? '' : 'border-t border-border'}`}>
      <Icon size={16} color={isCredit ? brand.hex : '#9AA8A3'} />
      <View className="flex-1">
        <Text variant="label" numberOfLines={1}>
          {entry.description}
        </Text>
        <Text variant="caption">{new Date(entry.createdAt).toLocaleDateString()}</Text>
      </View>
      <Text variant="label" className={isCredit ? 'text-primary' : 'text-muted-foreground'}>
        {isCredit ? '+' : ''}
        {entry.amount}
      </Text>
    </View>
  );
}

/**
 * What this group can send, and what it costs.
 *
 * A GROUP IS THE ORGANIZATION: the credits bought here belong to this group
 * alone and pay for this group's messages alone. Nothing is shared with the
 * other groups the same person may administer, which is why the balance is
 * shown against the group's name rather than the account's.
 */
export default function SmsScreen() {
  const brand = useBrand();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { membership } = useCurrentGroup();
  const { session } = useSession();

  const isAdmin =
    membership !== null && ROLE_RANK[membership.role as MemberRole] >= ROLE_RANK.admin;
  const groupId = isAdmin ? membership?.groupId : undefined;

  const balance = useSmsBalance(groupId);
  const transactions = useSmsTransactions(groupId);
  const setEnabled = useSetSmsEnabled();
  const purchase = useCreditPurchase(groupId);

  const [amount, setAmount] = useState<number>(PURCHASE_AMOUNTS[1]);

  const setCap = useSetMonthlyCap();
  // Null until touched, so the field shows the saved ceiling without copying
  // it into state from an effect.
  const [capDraft, setCapDraft] = useState<string | null>(null);
  const [capError, setCapError] = useState<string | null>(null);

  function saveCap() {
    if (!membership || capDraft === null) return;

    // Mirrors `groups_sms_monthly_cap_range`. Checked here so the message is a
    // sentence rather than a constraint name.
    const cap = Number(capDraft);
    if (!Number.isInteger(cap) || cap < 0 || cap > 100000) {
      setCapError('Enter a whole number between 0 and 100,000.');
      return;
    }

    setCap.mutate(
      { groupId: membership.groupId, cap },
      {
        onSuccess: () => setCapDraft(null),
        onError: (err) =>
          setCapError(err instanceof Error ? err.message : 'Could not save the ceiling.'),
      }
    );
  }

  const data = balance.data;
  const credits = data?.credits ?? 0;
  const capLeft = Math.max(0, (data?.monthlyCap ?? 0) - (data?.usedThisMonth ?? 0));

  function buy() {
    if (!membership || !session?.user) return;
    purchase.start({
      groupName: membership.groupName,
      userId: session.user.id,
      // Paystack requires an email for the receipt. An account that signed up by
      // phone has none, so the group's own name is not enough — fall back to a
      // deliverable address rather than refusing the purchase.
      email: session.user.email ?? 'receipts@fmtsoftware.com',
      amountGhs: amount,
    });
  }

  if (!isAdmin) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-8">
        <Text variant="caption" className="text-center">
          Only an admin can manage what this group spends on text messages.
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
        <Text variant="title">Text messages</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        contentContainerClassName="gap-4 px-5 pt-2"
        showsVerticalScrollIndicator={false}>
        {balance.isPending || !data ? (
          <Card>
            <ActivityIndicator />
          </Card>
        ) : (
          <>
            {/* -------------------------------------------------- balance -- */}
            <Card className="gap-3">
              <View className="flex-row items-center gap-2">
                <Wallet size={16} color={brand.hex} />
                <Text variant="caption">{membership?.groupName} has</Text>
              </View>

              <View className="flex-row items-baseline gap-2">
                <Text variant="display">{credits.toLocaleString()}</Text>
                <Text variant="caption">credits</Text>
              </View>

              {credits === 0 && (
                <View className="flex-row gap-2 rounded-lg bg-warning/20 p-3">
                  <TriangleAlert size={16} color="#B26B00" />
                  <Text variant="caption" className="flex-1">
                    No credits.
                  </Text>
                </View>
              )}
            </Card>

            {/* ----------------------------------------------- buy credits -- */}
            <View className="gap-2">
              <Text variant="label">Buy credits</Text>

              {purchase.phase === 'success' ? (
                <Card className="gap-3">
                  <View className="flex-row items-center gap-2">
                    <CircleCheck size={18} color={brand.hex} />
                    <Text variant="label">Payment received</Text>
                  </View>
                  <Button label="Buy more" variant="outline" onPress={purchase.reset} />
                </Card>
              ) : purchase.phase === 'timeout' ? (
                <Card className="gap-3">
                  <View className="flex-row items-center gap-2">
                    <Clock size={18} color="#B26B00" />
                    <Text variant="label">Still waiting for confirmation</Text>
                  </View>
                  <Button label="Done" variant="outline" onPress={purchase.reset} />
                </Card>
              ) : (
                <Card className="gap-3">
                  <View className="flex-row flex-wrap gap-2">
                    {PURCHASE_AMOUNTS.map((option) => {
                      const selected = option === amount;
                      return (
                        <Pressable
                          key={option}
                          accessibilityRole="radio"
                          accessibilityState={{ selected }}
                          accessibilityLabel={`GHS ${option}, ${creditsFor(option)} credits`}
                          onPress={() => setAmount(option)}
                          className={`rounded-lg border px-3 py-2 ${
                            selected ? 'border-primary bg-primary/10' : 'border-border'
                          }`}>
                          <Text variant="label">₵{option}</Text>
                          <Text variant="caption">
                            {creditsFor(option).toLocaleString()} credits
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  {purchase.error && (
                    <Text variant="caption" className="text-destructive">
                      {purchase.error}
                    </Text>
                  )}

                  <Button
                    label={purchase.phase === 'waiting' ? 'Waiting for payment…' : `Pay ₵${amount}`}
                    fullWidth
                    loading={purchase.phase === 'starting' || purchase.phase === 'waiting'}
                    onPress={buy}
                  />
                </Card>
              )}
            </View>

            {/* ------------------------------------------------- sender id -- */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Manage the sender ID"
              onPress={() => router.push('/sms/sender-id')}
              className="active:opacity-70">
              <Card className="flex-row items-center gap-3">
                <Signature size={18} color={brand.hex} />
                <View className="flex-1">
                  <Text variant="label">Sender ID</Text>
                  <Text variant="caption">{data.senderId ?? 'Kobox'}</Text>
                </View>
                <ChevronRight size={18} color="#9AA8A3" />
              </Card>
            </Pressable>

            {/* ---------------------------------------------------- limits -- */}
            <View className="gap-2">
              <Text variant="label">Limits</Text>
              <Card className="gap-0 p-0">
                <Pressable
                  accessibilityRole="switch"
                  accessibilityState={{ checked: data.enabled }}
                  accessibilityLabel="Send text messages for this group"
                  disabled={setEnabled.isPending}
                  onPress={() =>
                    membership &&
                    setEnabled.mutate({ groupId: membership.groupId, enabled: !data.enabled })
                  }
                  className="flex-row items-center gap-3 p-4 active:bg-secondary">
                  <View
                    className={`h-5 w-5 items-center justify-center rounded border ${
                      data.enabled ? 'border-primary bg-primary' : 'border-border'
                    }`}>
                    {data.enabled && <Check size={14} color="white" />}
                  </View>
                  <View className="flex-1">
                    <Text variant="label">Send text messages</Text>
                    <Text variant="caption">Off means no sms are sent.</Text>
                  </View>
                </Pressable>

                <View className="gap-3 border-t border-border p-4">
                  <View className="flex-row items-center justify-between gap-3">
                    <Text variant="label">This month&rsquo;s ceiling</Text>
                    <Badge
                      label={`${capLeft.toLocaleString()} of ${data.monthlyCap.toLocaleString()} left`}
                      tone={capLeft === 0 ? 'warning' : 'neutral'}
                    />
                  </View>

                  <View className="flex-row items-center gap-2">
                    <TextInput
                      value={capDraft ?? String(data.monthlyCap)}
                      onChangeText={(text) => {
                        setCapError(null);
                        setCapDraft(text.replace(/\D/g, ''));
                      }}
                      keyboardType="number-pad"
                      maxLength={6}
                      accessibilityLabel="Monthly ceiling in credits"
                      className="flex-1 rounded-lg border border-border bg-card px-4 py-2.5 text-base text-foreground"
                    />
                    <Text variant="caption">credits</Text>
                    <Button
                      label="Save"
                      size="sm"
                      disabled={
                        capDraft === null || capDraft === '' || Number(capDraft) === data.monthlyCap
                      }
                      loading={setCap.isPending}
                      onPress={saveCap}
                    />
                  </View>

                  {capError && (
                    <Text variant="caption" className="text-destructive">
                      {capError}
                    </Text>
                  )}
                </View>
              </Card>
            </View>

            {/* --------------------------------------------------- ledger -- */}
            <View className="gap-2">
              <Text variant="label">Activity</Text>
              <Card className="gap-0 p-0">
                {transactions.isPending ? (
                  <View className="p-4">
                    <ActivityIndicator />
                  </View>
                ) : (transactions.data ?? []).length === 0 ? (
                  <View className="p-4">
                    <Text variant="caption">
                      Nothing yet. Purchases and every message sent will be listed here.
                    </Text>
                  </View>
                ) : (
                  (transactions.data ?? []).map((entry, index) => (
                    <LedgerRow key={entry.id} entry={entry} first={index === 0} />
                  ))
                )}
              </Card>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}
