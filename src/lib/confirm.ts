import { Alert, Platform } from 'react-native';

export interface ConfirmOptions {
  title: string;
  message?: string;
  /** The word on the button that goes ahead. */
  confirmLabel: string;
  destructive?: boolean;
}

/**
 * "Are you sure?", on both targets.
 *
 * `Alert.alert` does nothing at all in a browser — no dialog, no callback — so
 * every action behind one was a dead button on the web: ending a contribution,
 * voiding an expense, sending a message. The browser's own `confirm` stands in
 * there. It cannot label its buttons, so the question itself has to carry what
 * OK means.
 */
export function confirm({
  title,
  message,
  confirmLabel,
  destructive,
}: ConfirmOptions): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(window.confirm(message ? `${title}\n\n${message}` : title));
  }

  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        {
          text: confirmLabel,
          style: destructive ? 'destructive' : 'default',
          onPress: () => resolve(true),
        },
      ],
      // Tapping outside the dialog on Android is a "no", not a promise that
      // never settles.
      { cancelable: true, onDismiss: () => resolve(false) }
    );
  });
}
