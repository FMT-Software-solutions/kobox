import { cva, type VariantProps } from 'class-variance-authority';
import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { cn } from '@/lib/cn';

const badgeVariants = cva('self-start rounded-full px-2.5 py-1', {
  variants: {
    tone: {
      neutral: 'bg-secondary',
      success: 'bg-success',
      warning: 'bg-warning',
      danger: 'bg-destructive',
      accent: 'bg-accent',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

const badgeTextVariants = cva('text-xs font-semibold', {
  variants: {
    tone: {
      neutral: 'text-secondary-foreground',
      success: 'text-success-foreground',
      warning: 'text-warning-foreground',
      danger: 'text-destructive-foreground',
      accent: 'text-accent-foreground',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

export interface BadgeProps extends VariantProps<typeof badgeVariants> {
  label: string;
  className?: string;
}

export function Badge({ label, tone, className }: BadgeProps) {
  return (
    <View className={cn(badgeVariants({ tone }), className)}>
      <Text className={cn(badgeTextVariants({ tone }))}>{label}</Text>
    </View>
  );
}
