import { cva, type VariantProps } from 'class-variance-authority';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { cn } from '@/lib/cn';

const buttonVariants = cva(
  'flex-row items-center justify-center gap-2 rounded-lg active:opacity-80',
  {
    variants: {
      variant: {
        primary: 'bg-primary',
        secondary: 'bg-secondary',
        accent: 'bg-accent',
        destructive: 'bg-destructive',
        outline: 'border border-border bg-transparent',
        ghost: 'bg-transparent',
      },
      size: {
        sm: 'px-3 py-2',
        md: 'px-4 py-3',
        lg: 'px-5 py-4',
      },
      fullWidth: {
        true: 'w-full',
      },
      disabled: {
        true: 'opacity-50',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  }
);

const buttonTextVariants = cva('font-semibold', {
  variants: {
    variant: {
      primary: 'text-primary-foreground',
      secondary: 'text-secondary-foreground',
      accent: 'text-accent-foreground',
      destructive: 'text-destructive-foreground',
      outline: 'text-foreground',
      ghost: 'text-foreground',
    },
    size: {
      sm: 'text-sm',
      md: 'text-base',
      lg: 'text-base',
    },
  },
  defaultVariants: { variant: 'primary', size: 'md' },
});

export interface ButtonProps
  extends
    Omit<React.ComponentProps<typeof Pressable>, 'disabled' | 'children'>,
    VariantProps<typeof buttonVariants> {
  label: string;
  loading?: boolean;
  icon?: React.ReactNode;
}

export function Button({
  label,
  loading = false,
  icon,
  className,
  variant,
  size,
  fullWidth,
  disabled,
  ...props
}: ButtonProps) {
  const isDisabled = Boolean(disabled) || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      className={cn(buttonVariants({ variant, size, fullWidth, disabled: isDisabled }), className)}
      {...props}>
      {loading ? (
        <ActivityIndicator size="small" />
      ) : (
        icon && <View className="shrink-0">{icon}</View>
      )}
      <Text className={cn(buttonTextVariants({ variant, size }))}>{label}</Text>
    </Pressable>
  );
}
