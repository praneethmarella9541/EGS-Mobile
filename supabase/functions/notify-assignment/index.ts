// Supabase Edge Function: notify-assignment
// Admin-triggered. Sends an Expo push to a field user (e.g. when assigned an
// area). Reads the user's Expo push token(s) with the service role and relays
// to Expo's push service, which delivers via FCM/APNs.
//
// Deploy:  supabase functions deploy notify-assignment

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

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Send to Expo; returns tokens Expo reported as no longer registered. */
async function sendExpoPush(
  tokens: string[],
  payload: { title: string; body: string; data?: Record<string, string> }
): Promise<string[]> {
  const valid = tokens.filter(
    (t) => t.startsWith('ExponentPushToken[') || t.startsWith('ExpoPushToken[')
  );
  if (!valid.length) return [];
  const invalid: string[] = [];
  for (const batch of chunk(valid, 100)) {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(
        batch.map((to) => ({
          to,
          sound: 'default',
          priority: 'high',
          channelId: 'default',
          title: payload.title,
          body: payload.body,
          data: payload.data ?? {},
        }))
      ),
    });
    if (!res.ok) {
      console.error('[expo-push] HTTP', res.status, await res.text().catch(() => ''));
      continue;
    }
    const out = (await res.json()) as {
      data?: { status?: string; message?: string; details?: { error?: string } }[];
    };
    (out.data ?? []).forEach((ticket, i) => {
      if (ticket.status !== 'error') return;
      console.warn('[expo-push] ticket error:', ticket.message, ticket.details);
      if (ticket.details?.error === 'DeviceNotRegistered' && batch[i]) invalid.push(batch[i]);
    });
  }
  return invalid;
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

  let body: { userId?: string; title?: string; body?: string; data?: Record<string, string> };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if (!body.userId) return json({ error: 'userId required' }, 400);

  const title = (body.title ?? 'New assignment').trim() || 'New assignment';
  const message = (body.body ?? '').trim() || 'You have a new area assignment.';

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: rows } = await admin
    .from('push_device_tokens')
    .select('expo_push_token')
    .eq('user_id', body.userId);
  const tokens = (rows ?? []).map((r) => r.expo_push_token as string).filter(Boolean);
  if (!tokens.length) return json({ sent: 0, reason: 'no tokens' });

  const invalid = await sendExpoPush(tokens, { title, body: message, data: body.data });

  // Prune tokens Expo says are dead so we don't keep retrying them.
  if (invalid.length) {
    await admin.from('push_device_tokens').delete().in('expo_push_token', invalid);
  }

  return json({ sent: tokens.length - invalid.length });
});
