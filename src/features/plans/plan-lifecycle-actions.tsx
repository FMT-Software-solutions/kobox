import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';

import type { PlanRow } from './api';
import { usePlanActions } from './use-plan-actions';
import { usePlanSummary } from './use-plans';

/**
 * End / Delete, with the explanation of which applies when. Shown on both the
 * contribution detail and edit screens — a treasurer looking to stop a
 * contribution should not have to guess that it lives behind "Edit".
 */
export function PlanLifecycleActions({ plan }: { plan: PlanRow }) {
  const { confirmEnd, confirmDelete, isEnding, isDeleting, error } = usePlanActions(plan);
  const summary = usePlanSummary(plan.id);

  // Offering a Delete that is certain to be refused is worse than not offering
  // it: the treasurer learns the rule only by hitting an error.
  const canDelete = summary.data ? !summary.data.hasMoney : false;

  return (
    <View className="mt-2 gap-2 border-t border-border pt-5">
      {plan.status === 'active' && (
        <Button
          label="End this contribution"
          variant="outline"
          fullWidth
          loading={isEnding}
          onPress={confirmEnd}
        />
      )}

      {canDelete && (
        <Button
          label="Delete this contribution"
          variant="ghost"
          fullWidth
          loading={isDeleting}
          onPress={confirmDelete}
        />
      )}

      {error && (
        <View className="rounded-lg bg-destructive/10 p-3">
          <Text variant="caption" className="text-destructive">
            {error}
          </Text>
        </View>
      )}

      <Text variant="caption" className="text-center">
        {canDelete
          ? 'Nobody has paid into this yet, so it can still be deleted. Ending it instead keeps it on record.'
          : 'This has payments recorded, so it can no longer be deleted. Ending it stops new periods opening and keeps every record.'}
      </Text>
    </View>
  );
}
