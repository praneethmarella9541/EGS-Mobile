import { supabase } from './supabase';

/**
 * Call a Supabase Edge Function via plain fetch.
 *
 * We avoid `supabase.functions.invoke` because in Expo Go / React Native it
 * frequently throws "Failed to send a request to the Edge Function" even when
 * the function is healthy. A direct fetch with the session JWT is reliable and
 * lets us surface the function's JSON `{ error }` message.
 */
export async function callEdge<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('You are not signed in.');

  const base = process.env.EXPO_PUBLIC_SUPABASE_URL!;
  const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

  let res: Response;
  try {
    res = await fetch(`${base}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anon,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  } catch (e: any) {
    throw new Error(`Network error reaching ${name}: ${e?.message ?? 'request failed'}`);
  }

  let payload: any = null;
  try {
    payload = await res.json();
  } catch {
    /* non-JSON response */
  }
  if (!res.ok) {
    throw new Error(payload?.error || `${name} failed (HTTP ${res.status})`);
  }
  return payload as T;
}
