import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthContext, useAuth, useAuthState } from '../hooks/useAuth';
import LoadingScreen from '../components/LoadingScreen';
import { FACE_VERIFICATION_ENABLED } from '../lib/types';

// iOS: dismiss the Safari auth sheet when the app reopens via egscrm:// callback.
WebBrowser.maybeCompleteAuthSession();

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { session, loading, isAdmin, profile } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  // Auth model: any Google sign-in is an admin (set by the DB trigger);
  // email/password accounts are users. No gate needed here.

  useEffect(() => {
    if (loading) return;
    const seg = segments as string[];
    const inAuthGroup = seg[0] === '(auth)';
    const onOAuthCallback = seg[0] === 'auth' && seg[1] === 'callback';
    const inAuthFlow = inAuthGroup || onOAuthCallback;
    const onFaceRegistration = seg[0] === 'face-registration';

    if (!session && !inAuthFlow) {
      router.replace('/(auth)/login');
      return;
    }
    if (session && inAuthFlow) {
      router.replace(isAdmin ? '/(workspace)/assignments' : '/(workspace)/tasks');
      return;
    }
    // Field users must register their face before doing anything else.
    const needsFaceRegistration =
      FACE_VERIFICATION_ENABLED && !!session && !isAdmin && !!profile && !profile.face_registered;
    if (needsFaceRegistration && !onFaceRegistration) {
      router.replace('/face-registration');
      return;
    }
    if (!needsFaceRegistration && onFaceRegistration) {
      router.replace(isAdmin ? '/(workspace)/assignments' : '/(workspace)/tasks');
      return;
    }
    // Admins land on Assignments, never on the user-only Tasks screen (e.g. a
    // stale/restored route from a previous session or deep link).
    if (session && isAdmin && seg[0] === '(workspace)' && seg[1] === 'tasks') {
      router.replace('/(workspace)/assignments');
    }
  }, [session, loading, isAdmin, profile, segments]);

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
              <Stack.Screen name="face-registration" />
              <Stack.Screen name="(workspace)" />
            </Stack>
          </AuthGuard>
        </AuthContext.Provider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
