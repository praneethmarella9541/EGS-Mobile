// Supabase Edge Function: admin-users
// Admins manage email/password users. The caller's JWT is verified to be an
// admin (via their profiles.role); privileged ops use the service-role key.
//
// Deploy:  supabase functions deploy admin-users
// Secrets: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY are
//          injected automatically by Supabase at runtime. Deleting a user also
//          purges their photos from GCS, which needs GCS_SA_KEY + GCS_BUCKET.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { deletePrefix } from '../_shared/gcs.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

type Action = 'list' | 'create' | 'update' | 'delete' | 'block' | 'unblock';
interface Payload {
  action: Action;
  id?: string;
  email?: string;
  password?: string;
  display_name?: string | null;
  restricted_features?: string[];
  mobile_phone?: string | null;
}

// GoTrue's ban is a duration, not a flag — there's no "forever". 100 years is
// the idiomatic stand-in every Supabase admin-ban example uses.
const BLOCK_DURATION = '876000h';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Missing token' }, 401);

  // 1. Verify the caller and that they are an admin.
  const callerClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userData.user) return json({ error: 'Invalid session' }, 401);

  const { data: callerProfile } = await callerClient
    .from('profiles')
    .select('role')
    .eq('id', userData.user.id)
    .single();
  if (callerProfile?.role !== 'admin') return json({ error: 'Admin access required' }, 403);

  // 2. Privileged client for user management.
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  try {
    switch (body.action) {
      case 'list': {
        const { data, error } = await admin
          .from('profiles')
          .select('id, email, display_name, role, restricted_features, mobile_phone, created_at')
          .eq('role', 'user')
          .order('created_at', { ascending: false });
        if (error) throw error;

        // Blocked status lives on the auth user (ban_duration), not the profile
        // row, so it's fetched per-member rather than stored redundantly.
        const members = await Promise.all(
          (data ?? []).map(async (m) => {
            const { data: authUser } = await admin.auth.admin.getUserById(m.id);
            const bannedUntil = authUser?.user?.banned_until;
            const blocked = !!bannedUntil && new Date(bannedUntil).getTime() > Date.now();
            return { ...m, blocked };
          })
        );
        return json({ members });
      }

      case 'create': {
        if (!body.email || !body.password) {
          return json({ error: 'email and password are required' }, 400);
        }
        const { data: created, error: createErr } = await admin.auth.admin.createUser({
          email: body.email.trim().toLowerCase(),
          password: body.password,
          email_confirm: true,
          user_metadata: { display_name: body.display_name ?? null },
        });
        if (createErr) throw createErr;

        // Trigger already inserted a 'user' profile; patch the extra fields.
        const { error: profErr } = await admin
          .from('profiles')
          .update({
            display_name: body.display_name ?? null,
            restricted_features: body.restricted_features ?? [],
            mobile_phone: body.mobile_phone ?? null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', created.user.id);
        if (profErr) throw profErr;
        return json({ id: created.user.id });
      }

      case 'update': {
        if (!body.id) return json({ error: 'id is required' }, 400);
        if (body.password || body.email) {
          const { error: authErr } = await admin.auth.admin.updateUserById(body.id, {
            ...(body.email ? { email: body.email.trim().toLowerCase() } : {}),
            ...(body.password ? { password: body.password } : {}),
          });
          if (authErr) throw authErr;
        }
        const { error: profErr } = await admin
          .from('profiles')
          .update({
            ...(body.email ? { email: body.email.trim().toLowerCase() } : {}),
            ...(body.display_name !== undefined ? { display_name: body.display_name } : {}),
            ...(body.restricted_features !== undefined
              ? { restricted_features: body.restricted_features }
              : {}),
            ...(body.mobile_phone !== undefined ? { mobile_phone: body.mobile_phone } : {}),
            updated_at: new Date().toISOString(),
          })
          .eq('id', body.id);
        if (profErr) throw profErr;
        return json({ ok: true });
      }

      // Blocking revokes sign-in without touching any data — profile, assignments,
      // attendance and photos all stay exactly as they are and remain visible
      // to admins. This is the primary "remove access" action; delete (below)
      // is the separate, irreversible one.
      case 'block': {
        if (!body.id) return json({ error: 'id is required' }, 400);
        const { error } = await admin.auth.admin.updateUserById(body.id, {
          ban_duration: BLOCK_DURATION,
        });
        if (error) throw error;
        return json({ ok: true });
      }

      case 'unblock': {
        if (!body.id) return json({ error: 'id is required' }, 400);
        const { error } = await admin.auth.admin.updateUserById(body.id, { ban_duration: 'none' });
        if (error) throw error;
        return json({ ok: true });
      }

      case 'delete': {
        if (!body.id) return json({ error: 'id is required' }, 400);

        // Remove the user's uploaded media before deleting the account. DB rows
        // cascade on user delete, but GCS objects do NOT — visit photos live at
        // <uid>/<visitId>/… in the bucket, so delete everything under their
        // prefix. Best-effort: a storage hiccup shouldn't block the deletion.
        try {
          await deletePrefix(`${body.id}/`);
        } catch (e) {
          console.error('Failed to remove user media on delete:', e);
        }

        const { error } = await admin.auth.admin.deleteUser(body.id);
        if (error) throw error;
        return json({ ok: true });
      }

      default:
        return json({ error: 'Unknown action' }, 400);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Server error' }, 500);
  }
});
