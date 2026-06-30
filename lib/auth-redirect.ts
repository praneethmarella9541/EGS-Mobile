import Constants from 'expo-constants';
import * as AuthSession from 'expo-auth-session';

/** Deep-link callback for dev-client / standalone builds. */
export const MOBILE_OAUTH_REDIRECT_SCHEME = 'egscrm://auth/callback';

/** True when running inside Expo Go (custom URL schemes are unavailable). */
export function isExpoGo(): boolean {
  return Constants.appOwnership === 'expo';
}

/**
 * OAuth redirect passed to Supabase + openAuthSessionAsync.
 * Expo Go: exp:// proxy URL. Dev-client / standalone: egscrm://auth/callback.
 */
export function getMobileOAuthRedirect(): string {
  if (isExpoGo()) {
    return AuthSession.makeRedirectUri({ path: 'auth/callback' });
  }
  return MOBILE_OAUTH_REDIRECT_SCHEME;
}

export function isMobileOAuthCallbackUrl(url: string): boolean {
  const bare = url.split('#')[0]!;
  if (/auth\/callback(\?|$)/.test(bare) || /--\/auth\/callback(\?|$)/.test(bare)) return true;
  if (bare.startsWith('exp://') && bare.includes('callback')) return true;
  return false;
}
