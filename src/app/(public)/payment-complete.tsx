import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CircleCheck, Clock, TriangleAlert } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Linking } from 'react-native';

import { PublicPage } from '@/components/shared/public-page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { useSession } from '@/features/auth/session-provider';
import { fetchPurchase } from '@/features/sms/api';

/** Every 3 seconds for 3 minutes — the same patience the app's own poll has. */
const POLL_MS = 3000;
const POLL_LIMIT = 60;

/**
 * Where Paystack lands the browser after a credit purchase.
 *
 * Public, because the phone app pays in the system browser, where nobody is
 * signed in. It needs no account: the reference Paystack appends to the URL is
 * the whole question, and the backend answers it for anyone who holds one.
 *
 * This page CONFIRMS a purchase; it does not make one. The Paystack webhook
 * credits the group whether or not anybody ever arrives here, so every state
 * below that is not a success has to leave room for the credits turning up
 * anyway.
 */
export default function PaymentCompleteScreen() {
  const router = useRouter();
  const { session } = useSession();
  // Paystack sends both; they carry the same value.
  const params = useLocalSearchParams<{ reference?: string; trxref?: string }>();
  const reference = params.reference || params.trxref || '';

  const [attempts, setAttempts] = useState(0);

  const purchase = useQuery({
    queryKey: ['sms', 'purchase', reference] as const,
    queryFn: () => {
      // Counted here, so a failed request uses up patience exactly as a
      // "not yet" does.
      setAttempts((n) => n + 1);
      return fetchPurchase(reference);
    },
    enabled: reference !== '',
    retry: false,
    staleTime: 0,
    // A query rather than an effect and a timer: it stops itself on a final
    // answer, and it stops after the limit whether the answers were "not yet"
    // or errors — a backend that keeps failing must not be polled for ever.
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === 'success' || status === 'failed') return false;
      return attempts >= POLL_LIMIT ? false : POLL_MS;
    },
  });

  const status = purchase.data?.status;
  const gaveUp = status !== 'success' && status !== 'failed' && attempts >= POLL_LIMIT;
  const credits = purchase.data?.creditsPurchased;

  function leave() {
    if (session) {
      router.replace('/sms');
    } else {
      // The phone app's checkout: hand back to the app that started it.
      Linking.openURL('kobox://sms').catch(() => {});
    }
  }

  return (
    <PublicPage title="Payment">
      <Card className="items-center gap-3 py-8">
        {reference === '' ? (
          <>
            <TriangleAlert size={36} color="#B45309" />
            <Text variant="heading">No payment to check</Text>
          </>
        ) : status === 'success' ? (
          <>
            <CircleCheck size={36} color="#15803D" />
            <Text variant="heading">Payment received</Text>
            {!!credits && <Text variant="body">{credits.toLocaleString()} credits added</Text>}
          </>
        ) : status === 'failed' ? (
          <>
            <TriangleAlert size={36} color="#B91C1C" />
            <Text variant="heading">Payment did not go through</Text>
          </>
        ) : gaveUp ? (
          <>
            <Clock size={36} color="#B45309" />
            <Text variant="heading">Still confirming</Text>
            <Text variant="caption" className="text-center">
              Credits appear once Paystack confirms the payment.
            </Text>
          </>
        ) : (
          <>
            <ActivityIndicator />
            <Text variant="heading">Confirming payment</Text>
          </>
        )}

        {reference !== '' && (
          <Text variant="caption" selectable>
            {reference}
          </Text>
        )}
      </Card>

      <Button label={session ? 'Back to text messages' : 'Open Kobox'} fullWidth onPress={leave} />
    </PublicPage>
  );
}
