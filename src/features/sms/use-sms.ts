import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  fetchPurchaseStatus,
  fetchSenderIdRequests,
  fetchSmsBalance,
  fetchSmsTransactions,
  initializePurchase,
  requestSenderId,
  setMonthlyCap,
  setSmsEnabled,
  withdrawSenderIdRequest,
} from './api';

export const smsKeys = {
  all: ['sms'] as const,
  balance: (groupId: string) => [...smsKeys.all, 'balance', groupId] as const,
  transactions: (groupId: string) => [...smsKeys.all, 'transactions', groupId] as const,
  senderIds: (groupId: string) => [...smsKeys.all, 'sender-ids', groupId] as const,
};

export function useSmsBalance(groupId: string | undefined) {
  return useQuery({
    queryKey: smsKeys.balance(groupId ?? ''),
    queryFn: () => fetchSmsBalance(groupId!),
    enabled: Boolean(groupId),
  });
}

export function useSmsTransactions(groupId: string | undefined) {
  return useQuery({
    queryKey: smsKeys.transactions(groupId ?? ''),
    queryFn: () => fetchSmsTransactions(groupId!),
    enabled: Boolean(groupId),
  });
}

export function useSetSmsEnabled() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: setSmsEnabled,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: smsKeys.all }),
  });
}

export function useSetMonthlyCap() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: setMonthlyCap,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: smsKeys.all }),
  });
}

export function useSenderIdRequests(groupId: string | undefined) {
  return useQuery({
    queryKey: smsKeys.senderIds(groupId ?? ''),
    queryFn: () => fetchSenderIdRequests(groupId!),
    enabled: Boolean(groupId),
  });
}

export function useRequestSenderId() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: requestSenderId,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: smsKeys.all }),
  });
}

export function useWithdrawSenderIdRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: withdrawSenderIdRequest,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: smsKeys.all }),
  });
}

/* ---------------------------------------------------------------- purchase -- */

export type PurchasePhase = 'idle' | 'starting' | 'waiting' | 'success' | 'failed' | 'timeout';

/** Every 3 seconds for 3 minutes — long enough for mobile money to settle. */
const POLL_MS = 3000;
const POLL_LIMIT = 60;

/**
 * Buying credits.
 *
 * Paystack is opened in the system browser rather than a WebView because
 * Ghanaian mobile money checkouts frequently hand off to a network's own page
 * or an app, and a WebView is where those redirects go to die.
 *
 * The purchase is then watched by POLLING, not by whatever the browser does on
 * the way back. That is the whole point of the design: the Paystack webhook
 * credits the group server-side whether or not this app is still running, so
 * the poll only asks "has it landed yet?". Closing the browser, killing the app
 * or losing signal costs the confirmation, never the credits.
 */
export function useCreditPurchase(groupId: string | undefined) {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<PurchasePhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelled = useRef(false);

  const stop = useCallback(() => {
    cancelled.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  // A poll that outlives the screen would call setState on an unmounted tree
  // and, worse, keep hitting the backend for a purchase nobody is watching.
  useEffect(() => stop, [stop]);

  const reset = useCallback(() => {
    stop();
    cancelled.current = false;
    setPhase('idle');
    setError(null);
  }, [stop]);

  const start = useCallback(
    async (input: { groupName: string; userId: string; email: string; amountGhs: number }) => {
      if (!groupId) return;

      cancelled.current = false;
      setError(null);
      setPhase('starting');

      let reference: string;
      try {
        const handle = await initializePurchase({ groupId, ...input });
        reference = handle.reference;
        setPhase('waiting');
        await WebBrowser.openBrowserAsync(handle.authorizationUrl);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not start the payment.');
        setPhase('failed');
        return;
      }

      let attempts = 0;

      const poll = async () => {
        if (cancelled.current) return;
        attempts += 1;

        try {
          const status = await fetchPurchaseStatus(reference);

          if (status === 'success') {
            setPhase('success');
            queryClient.invalidateQueries({ queryKey: smsKeys.all });
            return;
          }

          if (status === 'failed') {
            setError('Paystack reported the payment did not go through.');
            setPhase('failed');
            return;
          }
        } catch {
          // A dropped request mid-checkout is ordinary. Keep waiting; the
          // deadline below is what ends this, not one bad response.
        }

        if (attempts >= POLL_LIMIT) {
          // Not a failure. The webhook may still credit it minutes later, so
          // the wording this drives has to leave that door open.
          setPhase('timeout');
          queryClient.invalidateQueries({ queryKey: smsKeys.all });
          return;
        }

        timer.current = setTimeout(poll, POLL_MS);
      };

      timer.current = setTimeout(poll, POLL_MS);
    },
    [groupId, queryClient]
  );

  return { phase, error, start, reset };
}
