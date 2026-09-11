import { cva, type VariantProps } from 'class-variance-authority';
import { Text as RNText } from 'react-native';

import { cn } from '@/lib/cn';

const textVariants = cva('text-foreground', {
  variants: {
    variant: {
      display: 'text-4xl font-bold tracking-tight',
      title: 'text-2xl font-bold tracking-tight',
      heading: 'text-lg font-semibold',
      body: 'text-base',
      label: 'text-sm font-medium',
      caption: 'text-xs text-muted-foreground',
      muted: 'text-sm text-muted-foreground',
    },
  },
  defaultVariants: { variant: 'body' },
});

export type TextProps = React.ComponentProps<typeof RNText> & VariantProps<typeof textVariants>;

export function Text({ className, variant, ...props }: TextProps) {
  return <RNText className={cn(textVariants({ variant }), className)} {...props} />;
}
