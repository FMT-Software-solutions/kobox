import type { Session } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { supabase } from '@/lib/supabase';

interface SessionState {
  session: Session | null;
  /** True until the stored session has been read from disk — routing must wait for this. */
  isLoading: boolean;
}

const SessionContext = createContext<SessionState>({ session: null, isLoading: true });

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const queryClient = useQueryClient();
  const userIdRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;

    /**
     * Every cached query belongs to whoever was signed in when it ran, and not
     * one query key mentions the user — `['groups','memberships']`,
     * `['profile','me']`, `['member-links','claim']`. Sign out and back in as
     * someone else in the same app session and TanStack serves the previous
     * person's answers.
     *
     * That is how a member who WAS correctly linked saw "create or join a
     * group": the claim query had already resolved to 0 for the owner account,
     * `staleTime: Infinity` meant it never re-ran, and the membership list was
     * likewise the owner's. Nothing was wrong in the database.
     *
     * Clearing on a genuine identity change is the whole fix. Guarded by the
     * previous id, because a token refresh fires this listener too and wiping
     * the cache on every refresh would refetch the world for no reason.
     */
    function syncUser(nextSession: Session | null) {
      const nextId = nextSession?.user.id ?? null;
      if (userIdRef.current !== nextId) {
        userIdRef.current = nextId;
        queryClient.clear();
      }
      setSession(nextSession);
      setIsLoading(false);
    }

    // Restore whatever session is already on disk before deciding where to route.
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      syncUser(data.session);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      syncUser(nextSession);
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [queryClient]);

  const value = useMemo(() => ({ session, isLoading }), [session, isLoading]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  return useContext(SessionContext);
}
