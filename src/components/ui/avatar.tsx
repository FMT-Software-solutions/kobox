import { Image } from 'expo-image';
import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { cn } from '@/lib/cn';

const SIZES = {
  sm: { box: 'h-8 w-8', text: 'text-xs' },
  md: { box: 'h-10 w-10', text: 'text-sm' },
  lg: { box: 'h-14 w-14', text: 'text-lg' },
} as const;

export interface AvatarProps {
  name: string;
  uri?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}

/** First letters of the first and last name parts, e.g. "Ama Serwaa Boateng" → "AB". */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]!.charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1]!.charAt(0) : '';
  return (first + last).toUpperCase();
}

export function Avatar({ name, uri, size = 'md', className }: AvatarProps) {
  const { box, text } = SIZES[size];

  return (
    <View
      className={cn(
        'items-center justify-center overflow-hidden rounded-full bg-secondary',
        box,
        className
      )}>
      {uri ? (
        <Image source={{ uri }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
      ) : (
        <Text className={cn('font-semibold text-secondary-foreground', text)}>
          {initialsOf(name)}
        </Text>
      )}
    </View>
  );
}
