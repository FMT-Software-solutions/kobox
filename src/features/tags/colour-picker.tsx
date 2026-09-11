import { Check } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';

import { TAG_COLOURS } from './api';

export interface ColourPickerProps {
  value: string;
  onChange: (colour: string) => void;
  label?: string;
}

/**
 * A colour is how a tag is recognised at a glance in a members list, so the
 * swatches are large enough to hit and the chosen one is marked rather than
 * merely outlined — a ring alone is hard to see against a strong colour.
 */
export function ColourPicker({ value, onChange, label = 'Colour' }: ColourPickerProps) {
  return (
    <View className="gap-2">
      <Text variant="label">{label}</Text>
      <View className="flex-row flex-wrap gap-3">
        {TAG_COLOURS.map((colour) => {
          const isSelected = colour.toLowerCase() === value.toLowerCase();
          return (
            <Pressable
              key={colour}
              accessibilityRole="radio"
              accessibilityLabel={`Colour ${colour}`}
              accessibilityState={{ selected: isSelected }}
              onPress={() => onChange(colour)}
              className="h-11 w-11 items-center justify-center rounded-full"
              style={{ backgroundColor: colour }}>
              {isSelected && <Check size={20} color="white" />}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
