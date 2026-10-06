import { useRouter } from 'expo-router';
import {
  ChevronLeft,
  ChevronRight,
  HandCoins,
  Receipt,
  TrendingUp,
  UserRound,
  Users,
} from 'lucide-react-native';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { useBrand } from '@/features/groups/brand';
import { goBack } from '@/lib/navigation';

/**
 * Five reports, not a report builder.
 *
 * They answer different questions and cannot be one filterable table without
 * producing figures that do not reconcile: the cash book is about `paid_at`
 * over a window, and arrears are about cycles with no window at all.
 */
const REPORTS = [
  {
    key: 'contribution',
    title: 'By contribution',
    hint: 'One contribution, who has paid, and the total — the one groups circulate',
    icon: Receipt,
    href: '/reports/contribution' as const,
  },
  {
    key: 'cash',
    title: 'Cash book',
    hint: 'Money in, money out and the balance, for any period',
    icon: TrendingUp,
    href: '/reports/cash' as const,
  },
  {
    key: 'collections',
    title: 'Collections',
    hint: 'What came in over a period, and from whom',
    icon: HandCoins,
    href: '/reports/collections' as const,
  },
  {
    key: 'arrears',
    title: 'Who owes what',
    hint: 'Every member, worst first — the chase list',
    icon: Users,
    href: '/reports/arrears' as const,
  },
  {
    key: 'member',
    title: 'By member',
    hint: 'One person: payments, what they owe, and how they are doing',
    icon: UserRound,
    href: '/reports/member' as const,
  },
];

export default function ReportsScreen() {
  const brand = useBrand();
  const insets = useSafeAreaInsets();
  const router = useRouter();

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
        <Text variant="title">Reports</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        contentContainerClassName="gap-3 px-5 pt-2"
        showsVerticalScrollIndicator={false}>
        {REPORTS.map((report) => {
          const Icon = report.icon;
          return (
            <Pressable
              key={report.key}
              accessibilityRole="button"
              accessibilityLabel={report.title}
              onPress={() => router.push(report.href)}
              className="active:opacity-70">
              <Card className="flex-row items-center gap-3">
                <View className="rounded-md bg-secondary p-2">
                  <Icon size={18} color={brand.hex} />
                </View>
                <View className="flex-1">
                  <Text variant="label">{report.title}</Text>
                  <Text variant="caption">{report.hint}</Text>
                </View>
                <ChevronRight size={18} color="#9AA8A3" />
              </Card>
            </Pressable>
          );
        })}

        <Text variant="caption" className="mt-2 text-center">
          Every report can be shared as a message, a CSV or a PDF.
        </Text>
      </ScrollView>
    </View>
  );
}
