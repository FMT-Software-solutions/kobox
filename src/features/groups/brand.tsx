import { useColorScheme, vars } from 'nativewind';
import { View } from 'react-native';

import { brandPreset } from '@/lib/brand';

import { useCurrentGroup } from './current-group';

/**
 * Re-colours everything beneath it in the current group's brand.
 *
 * Tailwind's `primary` resolves through `--primary` (see `global.css`), so
 * overriding the variable here re-colours every `bg-primary`, `text-primary`
 * and `border-primary` in the app at once, in both light and dark. NativeWind
 * carries CSS variables through React context rather than a DOM, so this
 * reaches every screen the navigator renders beneath it.
 *
 * Switching group switches the brand, which is the point: somebody in two
 * groups can tell at a glance which one they are looking at.
 */
export function BrandScope({ children }: { children: React.ReactNode }) {
  const { membership } = useCurrentGroup();
  const { colorScheme } = useColorScheme();
  const preset = brandPreset(membership?.brandColour);
  const tone = colorScheme === 'dark' ? preset.dark : preset.light;

  return (
    <View
      style={[
        { flex: 1 },
        vars({
          '--primary': tone.primary,
          '--primary-foreground': tone.foreground,
          '--ring': tone.primary,
        }),
      ]}>
      {children}
    </View>
  );
}

/**
 * The brand as hex, for the places a CSS variable cannot reach — chiefly icon
 * `color` props. Outside a group (the sign-in screens) it is the Kobox default.
 */
export function useBrand() {
  const { membership } = useCurrentGroup();
  const preset = brandPreset(membership?.brandColour);
  return { key: preset.key, hex: preset.hex, deep: preset.deep };
}
