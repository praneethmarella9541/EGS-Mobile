import { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { completeOAuthFromUrl, parseOAuthCallback } from '../../lib/google-sign-in';
import { Colors } from '../../constants/colors';

/** Deep-link landing for `egscrm://auth/callback?code=…`. */
export default function AuthCallback() {
  const params = useLocalSearchParams<{ code?: string; error?: string; error_description?: string }>();
  const router = useRouter();
  const [status, setStatus] = useState<'working' | 'failed'>('working');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        if (params.error) {
          throw new Error(
            typeof params.error_description === 'string'
              ? params.error_description
              : String(params.error)
          );
        }

        const codeFromParams = typeof params.code === 'string' ? params.code : null;
        if (codeFromParams) {
          await completeOAuthFromUrl(
            `egscrm://auth/callback?code=${encodeURIComponent(codeFromParams)}`
          );
          return;
        }

        const initial = await Linking.getInitialURL();
        if (initial) {
          const parsed = parseOAuthCallback(initial);
          if (parsed.error) throw new Error(parsed.errorDescription?.trim() || parsed.error);
          if (parsed.code || (parsed.accessToken && parsed.refreshToken)) {
            await completeOAuthFromUrl(initial);
            return;
          }
        }

        router.replace('/(auth)/login');
      } catch (e) {
        if (cancelled) return;
        console.warn('[auth/callback]', e);
        setStatus('failed');
        setTimeout(() => router.replace('/(auth)/login'), 1200);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [params.code, params.error, params.error_description, router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator color={Colors.primary} />
      <Text style={styles.text}>
        {status === 'failed' ? 'Sign-in failed — returning to login…' : 'Signing you in…'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  text: { fontSize: 14, color: Colors.textSecondary },
});
