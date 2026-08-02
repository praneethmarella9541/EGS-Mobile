import { supabase } from './supabase';

let lastRegisteredPushToken: string | null = null;

export function getLastRegisteredPushToken(): string | null {
  return lastRegisteredPushToken;
}

function isMissingPushTable(message: string): boolean {
  return /push_device_tokens|does not exist|42P01|relation.*not found/i.test(message);
}

/** Store this device's Expo push token in Supabase (one token kept per user). */
export async function registerPushToken(expoPushToken: string, platform?: string): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const { data: saved, error } = await supabase
    .from('push_device_tokens')
    .upsert(
      {
        user_id: user.id,
        expo_push_token: expoPushToken,
        platform: platform?.trim() || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,expo_push_token' }
    )
    .select('id')
    .maybeSingle();

  if (!error && saved?.id) {
    lastRegisteredPushToken = expoPushToken;
    // Drop any stale tokens for this user (old devices / reinstalls).
    await supabase
      .from('push_device_tokens')
      .delete()
      .eq('user_id', user.id)
      .neq('expo_push_token', expoPushToken);
    return;
  }

  if (!error) {
    lastRegisteredPushToken = expoPushToken;
    return;
  }

  if (isMissingPushTable(error.message ?? '')) {
    throw new Error('push_device_tokens table missing — run supabase/schema.sql.');
  }
  throw new Error(error.message);
}

export async function unregisterPushToken(expoPushToken?: string): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  let q = supabase.from('push_device_tokens').delete().eq('user_id', user.id);
  if (expoPushToken?.trim()) q = q.eq('expo_push_token', expoPushToken.trim());

  const { error } = await q;
  if (error && !isMissingPushTable(error.message ?? '')) {
    console.warn('[push] unregister:', error.message);
  }
  lastRegisteredPushToken = null;
}
