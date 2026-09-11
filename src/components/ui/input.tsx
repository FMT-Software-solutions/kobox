import { Eye, EyeOff } from 'lucide-react-native';
import { forwardRef, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { cn } from '@/lib/cn';

export interface InputProps extends React.ComponentProps<typeof TextInput> {
  label?: string;
  error?: string | null;
  containerClassName?: string;
}

/**
 * A labelled text field.
 *
 * Any field given `secureTextEntry` gets a show/hide toggle for free. Typing a
 * password blind on a phone keyboard is where sign-ins fail, and doing it here
 * means no password field anywhere in the app can be written without one.
 */
export const Input = forwardRef<TextInput, InputProps>(function Input(
  { label, error, className, containerClassName, secureTextEntry, ...props },
  ref
) {
  const isSecret = Boolean(secureTextEntry);
  const [revealed, setRevealed] = useState(false);

  return (
    <View className={cn('gap-1.5', containerClassName)}>
      {label && <Text variant="label">{label}</Text>}

      <View className="justify-center">
        <TextInput
          ref={ref}
          placeholderTextColor="#9AA8A3"
          accessibilityLabel={label}
          secureTextEntry={isSecret && !revealed}
          className={cn(
            'rounded-lg border border-border bg-card px-4 py-3 text-base text-foreground',
            // Room for the toggle, so a long password never runs under it.
            isSecret && 'pr-12',
            error && 'border-destructive',
            className
          )}
          {...props}
        />

        {isSecret && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
            hitSlop={8}
            onPress={() => setRevealed((value) => !value)}
            className="absolute right-3 rounded-full p-1 active:opacity-60">
            {revealed ? <EyeOff size={20} color="#66756F" /> : <Eye size={20} color="#66756F" />}
          </Pressable>
        )}
      </View>

      {error && (
        <Text variant="caption" className="text-destructive">
          {error}
        </Text>
      )}
    </View>
  );
});
