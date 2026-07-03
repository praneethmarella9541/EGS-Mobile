import { callEdge } from './edge';

export interface TeamMember {
  id: string;
  email: string;
  display_name: string | null;
  role: 'user';
  restricted_features: string[];
  mobile_phone: string | null;
  created_at: string;
}

/** Invoke the admin-users Edge Function; the user's JWT is attached by callEdge. */
function invoke<T>(body: Record<string, unknown>): Promise<T> {
  return callEdge<T>('admin-users', body);
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
