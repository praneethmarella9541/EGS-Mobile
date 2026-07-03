import { supabase } from './supabase';
import { callEdge } from './edge';

/**
 * Right after Google OAuth, the session carries a `provider_refresh_token`
 * (because we requested access_type=offline + prompt=consent). It is only
 * present immediately after sign-in, so we persist it server-side via the
 * `google-link` Edge Function. The Forms Edge Functions later use it to mint
 * fresh Google access tokens. The refresh token never lives in app storage.
 */
export async function captureGoogleRefreshToken(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const refreshToken = (data.session as any)?.provider_refresh_token as string | undefined;
  if (!refreshToken) return; // nothing new to store (re-login without consent)
  try {
    await callEdge('google-link', { refresh_token: refreshToken });
  } catch {
    // Non-fatal: form creation will prompt to reconnect Google if missing.
  }
}
