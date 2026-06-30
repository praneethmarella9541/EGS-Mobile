import { supabase } from './supabase';

export interface TeamMember {
  id: string;
  email: string;
  display_name: string | null;
  role: 'user';
  restricted_features: string[];
  mobile_phone: string | null;
  created_at: string;
}

/** Invoke the admin-users Edge Function; the user's JWT is attached automatically. */
async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('admin-users', { body });
  if (error) {
    // Surface the function's JSON { error } message when present.
    const ctx = (error as { context?: { body?: unknown } }).context;
    const msg =
      (ctx?.body && typeof ctx.body === 'object' && (ctx.body as any).error) || error.message;
    throw new Error(String(msg));
  }
  if (data && typeof data === 'object' && 'error' in data) {
    throw new Error(String((data as any).error));
  }
  return data as T;
}

export const adminUsers = {
  list: () => invoke<{ members: TeamMember[] }>({ action: 'list' }),

  create: (input: {
    email: string;
    password: string;
    display_name?: string | null;
    restricted_features?: string[];
    mobile_phone?: string | null;
  }) => invoke<{ id: string }>({ action: 'create', ...input }),

  update: (input: {
    id: string;
    email?: string;
    password?: string;
    display_name?: string | null;
    restricted_features?: string[];
    mobile_phone?: string | null;
  }) => invoke<{ ok: true }>({ action: 'update', ...input }),

  remove: (id: string) => invoke<{ ok: true }>({ action: 'delete', id }),
};
