import { View } from 'react-native';

import { cn } from '@/lib/cn';

type ViewProps = React.ComponentProps<typeof View>;

export function Card({ className, ...props }: ViewProps) {
  return (
    <View className={cn('rounded-lg border border-border bg-card p-4', className)} {...props} />
  );
}

export function CardHeader({ className, ...props }: ViewProps) {
  return <View className={cn('mb-3 gap-1', className)} {...props} />;
}

export function CardContent({ className, ...props }: ViewProps) {
  return <View className={cn('gap-2', className)} {...props} />;
}

export function CardFooter({ className, ...props }: ViewProps) {
  return (
    <View className={cn('mt-3 flex-row items-center justify-between', className)} {...props} />
  );
}
