import { useRouter } from 'expo-router';
import { useState } from 'react';

import { confirm } from '@/lib/confirm';
import { goBack } from '@/lib/navigation';

import type { PlanRow } from './api';
import { useDeletePlan, useUpdatePlan } from './use-plans';

/**
 * Ending and deleting a contribution, shared by the detail and edit screens so
 * the confirmation wording and the rules behind it cannot drift apart.
 *
 * Ending is the safe option and keeps every record. Deleting is only possible
 * while nobody has paid in — the database refuses otherwise, and the message it
 * returns is shown as-is rather than being second-guessed here.
 */
export function usePlanActions(plan: PlanRow) {
  const router = useRouter();
  const updatePlan = useUpdatePlan();
  const deletePlan = useDeletePlan();
  const [error, setError] = useState<string | null>(null);

  async function confirmEnd() {
    const yes = await confirm({
      title: 'End this contribution?',
      message: 'No new periods will open. Everything already recorded stays exactly as it is.',
      confirmLabel: 'End it',
      destructive: true,
    });
    if (!yes) return;

    setError(null);
    try {
      await updatePlan.mutateAsync({ planId: plan.id, status: 'ended' });
      goBack();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not end the contribution.');
    }
  }

  async function confirmDelete() {
    const yes = await confirm({
      title: 'Delete this contribution?',
      message: 'This cannot be undone. It is only possible while nobody has paid into it.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!yes) return;

    setError(null);
    try {
      await deletePlan.mutateAsync(plan.id);
      // The detail screen has nothing left to show.
      router.dismissTo('/contributions');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the contribution.');
    }
  }

  return {
    confirmEnd,
    confirmDelete,
    isEnding: updatePlan.isPending,
    isDeleting: deletePlan.isPending,
    error,
  };
}
