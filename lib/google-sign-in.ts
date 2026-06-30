import { AppState, Platform } from 'react-native';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from './supabase';
import { captureGoogleRefreshToken } from './google-credentials';
import {
  getExpoGoReturnUri,
  getMobileOAuthRedirect,
  getOAuthBridgeUrl,
  isExpoGo,
  isHttpsMobileCallback,
  isMobileOAuthCallbackUrl,
  supabaseRedirectIsMobile,
} from './auth-redirect';

export { getMobileOAuthRedirect, isMobileOAuthCallbackUrl, isExpoGo };

// Identity + Google Forms (create/edit), responses (read), and Drive.file
// (list/manage the forms our app creates). Least-privilege Drive scope.
const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/forms.body',
  'https://www.googleapis.com/auth/forms.responses.readonly',
  'https://www.googleapis.com/auth/drive.file',
].join(' ');

const OAUTH_WAIT_MS = 60_000;

let exchangeInFlight: Promise<void> | null = null;

/** Parse ?query and #hash params from any callback URL (custom schemes included). */
export function parseOAuthCallback(url: string): {
  code: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  error: string | null;
  errorDescription: string | null;
} {
  const queryPart = url.includes('?') ? (url.split('?')[1]?.split('#')[0] ?? '') : '';
  const hashPart = url.includes('#') ? (url.split('#')[1] ?? '') : '';
  const query = new URLSearchParams(queryPart);
  const hash = new URLSearchParams(hashPart);
  return {
    code: query.get('code'),
    accessToken: hash.get('access_token'),
    refreshToken: hash.get('refresh_token'),
    error: query.get('error') ?? hash.get('error'),
    errorDescription: query.get('error_description') ?? hash.get('error_description'),
  };
}

export function finishOAuthBrowser(): void {
  WebBrowser.maybeCompleteAuthSession();
}

async function exchangeCallbackUrl(callbackUrl: string): Promise<void> {
  const { code, accessToken, refreshToken, error, errorDescription } =
    parseOAuthCallback(callbackUrl);
  if (error) throw new Error(errorDescription?.trim() || error);
  if (code) {
    const { error: exchangeErr } = await supabase.auth.exchangeCodeForSession(code);
    if (exchangeErr) throw exchangeErr;
    await captureGoogleRefreshToken();
    return;
  }
  if (accessToken && refreshToken) {
    const { error: sessionErr } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (sessionErr) throw sessionErr;
    await captureGoogleRefreshToken();
    return;
  }
  throw new Error('No authorization code returned from Google.');
}

/** Exchange a callback URL into a Supabase session (deduped across handlers). */
export async function completeOAuthFromUrl(callbackUrl: string): Promise<void> {
  if (!isMobileOAuthCallbackUrl(callbackUrl) && !isHttpsMobileCallback(callbackUrl)) return;
  if (!exchangeInFlight) {
    exchangeInFlight = exchangeCallbackUrl(callbackUrl).finally(() => {
      exchangeInFlight = null;
    });
  }
  await exchangeInFlight;
  finishOAuthBrowser();
}

function urlIsOAuthCallback(url: string): boolean {
  if (isMobileOAuthCallbackUrl(url)) return true;
  if (isHttpsMobileCallback(url)) return true;
  const expPrefix = getExpoGoReturnUri().split('?')[0]!;
  return url.startsWith(expPrefix);
}

/**
 * Resolve the OAuth result via every channel Expo Go might use:
 *  - a deep link (exp:// or egscrm://) carrying the ?code=,
 *  - the app returning to foreground (re-check getInitialURL + session),
 *  - a 300ms poll of getSession() (handles the bridge's exp:// fallback hop).
 * Resolves with a callback URL to exchange, or null if the session already exists
 * (or it timed out).
 */
function waitForOAuthCallback(): { promise: Promise<string | null>; cancel: () => void } {
  let settled = false;
  let linkSub: { remove: () => void } | null = null;
  let appSub: { remove: () => void } | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

  const cleanup = () => {
    linkSub?.remove();
    appSub?.remove();
    if (pollTimer) clearInterval(pollTimer);
    if (timeoutTimer) clearTimeout(timeoutTimer);
  };

  const promise = new Promise<string | null>((resolve) => {
    const finish = (url: string | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(url);
    };

    const tryUrl = (url: string | null) => {
      if (url && urlIsOAuthCallback(url)) finish(url);
    };

    const trySession = async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        finishOAuthBrowser();
        finish(null);
      }
    };

    linkSub = Linking.addEventListener('url', ({ url }) => tryUrl(url));
    appSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void Linking.getInitialURL().then(tryUrl);
        void trySession();
      }
    });
    pollTimer = setInterval(() => void trySession(), 300);
    timeoutTimer = setTimeout(() => finish(null), OAUTH_WAIT_MS);

    void Linking.getInitialURL().then(tryUrl);
    void trySession();
  });

  return {
    promise,
    cancel: () => {
      if (!settled) {
        settled = true;
        cleanup();
      }
    },
  };
}

/**
 * Google sign-in.
 * Expo Go: bridge → Google → https mobile-callback?code= (captured by the in-app
 *   browser) → exchange. exp:// is only a delayed server-side fallback.
 * Dev-client / standalone: egscrm://auth/callback deep link.
 */
export async function signInWithGoogle(): Promise<void> {
  const redirectTo = getMobileOAuthRedirect();
  const oauthWaiter = waitForOAuthCallback();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      skipBrowserRedirect: true,
      queryParams: {
        scope: GOOGLE_SCOPES,
        access_type: 'offline', // ask Google for a refresh token
        prompt: 'consent', // force refresh-token issuance on re-consent
      },
    },
  });
  if (error) {
    oauthWaiter.cancel();
    throw error;
  }
  if (!data.url) {
    oauthWaiter.cancel();
    throw new Error('Supabase did not return an OAuth URL.');
  }

  const redirectParam = decodeURIComponent(
    new URL(data.url).searchParams.get('redirect_to') ?? ''
  );

  // If Supabase ignored our redirect (URL not allowlisted), it silently falls
  // back to the project's Site URL — surface that instead of hanging.
  if (isExpoGo() && !supabaseRedirectIsMobile(redirectParam)) {
    oauthWaiter.cancel();
    throw new Error(
      `Supabase is redirecting to the website instead of the app.\n\n` +
        `Expected:\n${redirectTo}\n\n` +
        `Got:\n${redirectParam || '(empty)'}\n\n` +
        `Add ${redirectTo} to Supabase → Authentication → URL Configuration → Redirect URLs.`
    );
  }

  const browserStartUrl = isExpoGo() ? getOAuthBridgeUrl(data.url) : data.url;
  const authSessionReturn = (isExpoGo() ? redirectParam || redirectTo : redirectTo).split('?')[0]!;

  if (Platform.OS === 'android') {
    try {
      await WebBrowser.warmUpAsync();
    } catch {
      /* optional */
    }
  }

  try {
    const result = await WebBrowser.openAuthSessionAsync(browserStartUrl, authSessionReturn, {
      preferEphemeralSession: false,
      createTask: false,
    });

    if (result.type === 'cancel') return;

    let callbackUrl: string | null = null;

    if (result.type === 'success' && result.url && urlIsOAuthCallback(result.url)) {
      callbackUrl = result.url;
    } else {
      // dismiss / opened: the bridge may still be completing — wait it out.
      callbackUrl = await oauthWaiter.promise;
    }

    oauthWaiter.cancel();

    if (callbackUrl) {
      await completeOAuthFromUrl(callbackUrl);
    }

    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      throw new Error('Google sign-in did not finish. Please try again.');
    }

    finishOAuthBrowser();
  } finally {
    oauthWaiter.cancel();
    finishOAuthBrowser();
    if (Platform.OS === 'android') {
      try {
        await WebBrowser.coolDownAsync();
      } catch {
        /* optional */
      }
    }
  }
}
