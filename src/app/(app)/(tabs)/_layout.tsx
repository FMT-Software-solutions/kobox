import { Tabs } from 'expo-router';
import { Home, ReceiptText, Menu } from 'lucide-react-native';
import { Platform } from 'react-native';

import { useBrand } from '@/features/groups/brand';
import { useIsDark } from '@/lib/use-is-dark';

/**
 * Three tabs, deliberately. Every extra tab is a decision the user has to make
 * before they can do anything; Kobox should be usable without reading a manual.
 */
export default function TabsLayout() {
  // The app's own answer, not the device's: in a browser the two can differ,
  // and the tab bar would then be the one light strip on a dark page.
  const isDark = useIsDark();
  const brand = useBrand();

  // The tab bar sits outside the NativeWind tree, so it reads the same token
  // values directly. Keep these in sync with src/global.css. The active tint
  // follows the group's brand; jade keeps its tuned dark-mode shade.
  const colors = isDark
    ? {
        active: brand.key === 'jade' ? '#22C79A' : brand.hex,
        inactive: '#8A9E97',
        bg: '#0F1F1A',
        border: '#26332F',
      }
    : { active: brand.deep, inactive: '#66756F', bg: '#FFFFFF', border: '#E2EAE7' };

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.active,
        tabBarInactiveTintColor: colors.inactive,
        tabBarStyle: {
          backgroundColor: colors.bg,
          borderTopColor: colors.border,
          // The default bar is sized for a phone with a home-indicator inset
          // below it. A browser has none, and the labels were cut in half.
          ...(Platform.OS === 'web' ? { height: 64 } : null),
        },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => <Home color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="contributions"
        options={{
          title: 'Contributions',
          tabBarIcon: ({ color, size }) => <ReceiptText color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: 'More',
          tabBarIcon: ({ color, size }) => <Menu color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
