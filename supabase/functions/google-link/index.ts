// Supabase Edge Function: google-link
// Stores the signed-in admin's Google OAuth refresh token so the Forms
// functions can mint fresh access tokens later. Caller must be an admin.
//
// Deploy:  supabase functions deploy google-link

import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Missing token' }, 401);

  const callerClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userData.user) return json({ error: 'Invalid session' }, 401);

  const { data: profile } = await callerClient
    .from('profiles')
    .select('role')
    .eq('id', userData.user.id)
    .single();
  if (profile?.role !== 'admin') return json({ error: 'Admin access required' }, 403);

  let body: { refresh_token?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if (!body.refresh_token) return json({ error: 'refresh_token required' }, 400);

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await admin.from('google_credentials').upsert({
    user_id: userData.user.id,
    refresh_token: body.refresh_token,
    updated_at: new Date().toISOString(),
  });
  if (error) return json({ error: error.message }, 500);

  return json({ ok: true });
});
