import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthContext, useAuth, useAuthState } from '../hooks/useAuth';
import LoadingScreen from '../components/LoadingScreen';

// iOS: dismiss the Safari auth sheet when the app reopens via egscrm:// callback.
WebBrowser.maybeCompleteAuthSession();

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { session, user, profile, loading, isAdmin, signOut } = useAuth();
  const router = useRouter();
  const segments = useSegments();
  const blockedRef = useRef(false);

  // Google sign-in grants admin ONLY for allowlisted emails (the DB trigger sets
  // role=admin for them). A Google user who isn't an admin isn't authorized —
  // sign them out. Email/password users (created by an admin) are unaffected.
  useEffect(() => {
    if (loading || !user || !profile) return;
    const provider = user.app_metadata?.provider;
    const providers = (user.app_metadata?.providers as string[] | undefined) ?? [];
    const isGoogle = provider === 'google' || providers.includes('google');
    if (isGoogle && !isAdmin && !blockedRef.current) {
      blockedRef.current = true;
      Alert.alert(
        'Access denied',
        'This Google account is not an authorized admin. Ask an existing admin to add your email to the allowlist.'
      );
      void signOut();
    }
    if (isAdmin) blockedRef.current = false;
  }, [loading, user, profile, isAdmin, signOut]);

  useEffect(() => {
    if (loading) return;
    const seg = segments as string[];
    const inAuthGroup = seg[0] === '(auth)';
    const onOAuthCallback = seg[0] === 'auth' && seg[1] === 'callback';
    const inAuthFlow = inAuthGroup || onOAuthCallback;

    if (!session && !inAuthFlow) router.replace('/(auth)/login');
    if (session && inAuthFlow) router.replace('/');
  }, [session, loading, segments]);

  if (loading) return <LoadingScreen />;
  return <>{children}</>;
}

export default function RootLayout() {
  const auth = useAuthState();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="auto" />
        <AuthContext.Provider value={auth}>
          <AuthGuard>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="(auth)" />
              <Stack.Screen name="auth/callback" />
              <Stack.Screen name="(workspace)" />
            </Stack>
          </AuthGuard>
        </AuthContext.Provider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
