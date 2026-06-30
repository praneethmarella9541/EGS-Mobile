import Constants from 'expo-constants';
import * as Linking from 'expo-linking';

// Expo Go can't reliably capture an `exp://` OAuth redirect, so we route Google
// sign-in through an HTTPS bridge that lands the `?code=` on an https URL the
// in-app browser CAN capture. The bridge is generic (any *.supabase.co auth URL
// + any exp:// return) and is hosted at thenucleus.in. Override with
// EXPO_PUBLIC_API_BASE_URL if you self-host the bridge.
//
// IMPORTANT: the bridge is used ONLY inside Expo Go. Native dev-client and
// standalone builds use the egscrm:// deep link below and never hit the bridge.
const API_BASE = (process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://www.thenucleus.in').replace(
  /\/$/,
  ''
);

const MOBILE_CALLBACK_URL = `${API_BASE}/auth/mobile-callback`;

/** Deep-link callback for dev-client / standalone builds. */
export const MOBILE_OAUTH_REDIRECT_SCHEME = 'egscrm://auth/callback';

/** True when running inside Expo Go (custom URL schemes are unavailable). */
export function isExpoGo(): boolean {
  return Constants.appOwnership === 'expo';
}

/**
 * OAuth redirect passed to Supabase.
 * Expo Go: the HTTPS bridge callback. Dev-client / standalone: egscrm://auth/callback.
 */
export function getMobileOAuthRedirect(): string {
  if (isExpoGo()) {
    return MOBILE_CALLBACK_URL;
  }
  return MOBILE_OAUTH_REDIRECT_SCHEME;
}

/** Entry URL for the bridge: it stores the exp:// return, then redirects to Supabase. */
export function getOAuthBridgeUrl(supabaseAuthUrl: string): string {
  const expReturn = getExpoGoReturnUri();
  return `${API_BASE}/auth/mobile-bridge?return=${encodeURIComponent(expReturn)}&auth=${encodeURIComponent(supabaseAuthUrl)}`;
}

/** This Expo Go instance's deep link (exp://<lan>:<port>/--/auth/callback). */
export function getExpoGoReturnUri(): string {
  return Linking.createURL('auth/callback');
}

export function isMobileOAuthCallbackUrl(url: string): boolean {
  const bare = url.split('#')[0]!;
  if (/auth\/callback(\?|$)/.test(bare) || /--\/auth\/callback(\?|$)/.test(bare)) return true;
  if (bare.startsWith('exp://') && bare.includes('callback')) return true;
  if (bare.startsWith('egscrm://') && bare.includes('auth/callback')) return true;
  return false;
}

/** Guard: did Supabase actually accept a mobile redirect (vs. silently falling back to a web URL)? */
export function supabaseRedirectIsMobile(redirectParam: string): boolean {
  const p = redirectParam.trim();
  return (
    p.includes('/auth/mobile-callback') ||
    p.startsWith('exp://') ||
    p.includes('egscrm://auth/callback')
  );
}

/** Match the HTTPS bridge callback that openAuthSessionAsync captures in Expo Go. */
export function isHttpsMobileCallback(url: string): boolean {
  return url.split('#')[0]!.startsWith(MOBILE_CALLBACK_URL);
}
