import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/cn';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  /** Say what to do next, not just that something is missing. */
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  className,
}: EmptyStateProps) {
  return (
    <View className={cn('items-center gap-3 rounded-lg bg-secondary/50 px-6 py-10', className)}>
      {icon}
      <Text variant="heading" className="text-center">
        {title}
      </Text>
      {description && (
        <Text variant="muted" className="text-center">
          {description}
        </Text>
      )}
      {actionLabel && onAction && (
        <Button label={actionLabel} onPress={onAction} className="mt-1" />
      )}
    </View>
  );
}
