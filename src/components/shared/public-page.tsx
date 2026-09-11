import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';

/**
 * The frame for a public page.
 *
 * A readable column on a laptop and edge to edge on a phone: `max-w-2xl`
 * does nothing below its width and stops a paragraph running the full width of
 * a desktop browser. The back arrow only appears when there is somewhere to go
 * back to — on the web, somebody usually arrives at these pages from a link.
 */
export function PublicPage({ title, children }: { title: string; children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}>
        <View className="w-full max-w-2xl gap-5 self-center px-5">
          <View className="flex-row items-center gap-2">
            {router.canGoBack() && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Go back"
                onPress={() => router.back()}
                className="-ml-2 rounded-full p-2 active:bg-secondary">
                <ChevronLeft size={22} color="#66756F" />
              </Pressable>
            )}
            <Text variant="title">{title}</Text>
          </View>
          {children}
        </View>
      </ScrollView>
    </View>
  );
}
