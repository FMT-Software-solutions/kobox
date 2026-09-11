import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useMemo, useState } from 'react';

import type { MembershipWithGroup } from './api';
import { useMyMemberships } from './use-groups';

const KEY = 'kobox.current-group';
const selectedGroupKey = ['groups', 'selected'] as const;

async function readSelectedGroup(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(KEY);
  } catch {
    // Falling back to the first membership is always safe.
    return null;
  }
}

interface CurrentGroupState {
  membership: MembershipWithGroup | null;
  memberships: MembershipWithGroup[];
  selectGroup: (groupId: string) => void;
  isLoading: boolean;
}

const CurrentGroupContext = createContext<CurrentGroupState>({
  membership: null,
  memberships: [],
  selectGroup: () => {},
  isLoading: true,
});

/**
 * Tracks which group the user is currently looking at.
 *
 * The choice is persisted. It has to be: now that phone linking drops people
 * into groups a treasurer created for them months ago, the first membership by
 * `created_at` is often not the one they care about, and a switcher that forgot
 * itself on every launch would be worse than none.
 *
 * Read as a query rather than an effect — AsyncStorage is async, and React
 * Compiler rejects seeding state from an effect. While it loads, the stored id
 * is undefined and we fall back to the first membership, which is exactly what
 * the app did before.
 */
export function CurrentGroupProvider({ children }: { children: React.ReactNode }) {
  const { data, isPending } = useMyMemberships();
  const { data: storedId } = useQuery({
    queryKey: selectedGroupKey,
    queryFn: readSelectedGroup,
    staleTime: Infinity,
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const value = useMemo<CurrentGroupState>(() => {
    const memberships = data ?? [];

    function selectGroup(groupId: string) {
      setSelectedId(groupId);
      // Fire and forget: the selection is already applied in memory, and a
      // failed write only costs the choice on next launch.
      AsyncStorage.setItem(KEY, groupId).catch(() => {});
      queryClient.setQueryData(selectedGroupKey, groupId);
    }

    // In-session choice first, then the remembered one, then the oldest
    // membership. A stored id for a group they have since left falls through.
    const membership =
      memberships.find((item) => item.groupId === selectedId) ??
      memberships.find((item) => item.groupId === storedId) ??
      memberships[0] ??
      null;

    return {
      membership,
      memberships,
      selectGroup,
      isLoading: isPending,
    };
  }, [data, selectedId, storedId, isPending, queryClient]);

  return <CurrentGroupContext.Provider value={value}>{children}</CurrentGroupContext.Provider>;
}

export function useCurrentGroup() {
  return useContext(CurrentGroupContext);
}
