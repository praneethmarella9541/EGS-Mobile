import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { Profile } from '../lib/types';
import { resetAppSessionCaches } from '../lib/session-reset';

interface AuthCtx {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  isAdmin: boolean;
  signOut: () => Promise<void>;
  hasFeature: (feature: string) => boolean;
}

export const AuthContext = createContext<AuthCtx>({
  session: null,
  user: null,
  profile: null,
  loading: true,
  isAdmin: false,
  signOut: async () => {},
  hasFeature: () => false,
});

export function useAuth() {
  return useContext(AuthContext);
}

export function useAuthState(): AuthCtx {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const lastUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const nextUser = data.session?.user ?? null;
      lastUserIdRef.current = nextUser?.id ?? null;
      setSession(data.session);
      setUser(nextUser);
      if (nextUser) fetchProfile(nextUser.id);
      else setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user ?? null;
      const nextUserId = nextUser?.id ?? null;
      const prevUserId = lastUserIdRef.current;

      if (!nextUserId || (prevUserId && prevUserId !== nextUserId)) {
        void resetAppSessionCaches(prevUserId ?? undefined);
      }

      lastUserIdRef.current = nextUserId;
      setSession(session);
      setUser(nextUser);
      if (nextUser) fetchProfile(nextUser.id);
      else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  async function fetchProfile(userId: string) {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single();
    setProfile(data);
    setLoading(false);
  }

  async function signOut() {
    const userId = user?.id;
    await resetAppSessionCaches(userId);
    await supabase.auth.signOut();
  }

  const isAdmin = profile?.role === 'admin';

  function hasFeature(feature: string): boolean {
    if (!profile) return false;
    if (profile.role === 'admin') return true;
    return !(profile.restricted_features ?? []).includes(feature);
  }

  return { session, user, profile, loading, isAdmin, signOut, hasFeature };
}
