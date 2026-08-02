import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { router } from 'expo-router';
import type { Session } from '@supabase/supabase-js';
import { getNotifications, obtainExpoPushToken, ensureNotificationChannels } from '../lib/expo-push-native';
import { registerPushToken, unregisterPushToken } from '../lib/push-notifications';

/** Route the user based on the tapped notification's `data.type`. */
function navigateFromNotificationData(data: Record<string, unknown> | undefined) {
  if (!data) return;
  if (data.type === 'assignment') {
    router.push('/(workspace)/tasks');
  }
}

/**
 * Registers this device's Expo push token while signed in (and removes it on
 * sign-out), and routes taps. No-ops safely in Expo Go — expo-notifications
 * isn't linked there, so getNotifications() returns null.
 */
export function usePushNotifications(session: Session | null) {
  const registeredToken = useRef<string | null>(null);

  // Register / unregister on auth changes.
  useEffect(() => {
    if (!session) {
      const token = registeredToken.current;
      if (token) {
        void unregisterPushToken(token);
        registeredToken.current = null;
      }
      return;
    }

    const Notifications = getNotifications();
    if (!Notifications) return;
    void ensureNotificationChannels();

    let cancelled = false;
    (async () => {
      const token = await obtainExpoPushToken();
      if (cancelled || !token) return;
      try {
        await registerPushToken(token, Platform.OS);
        registeredToken.current = token;
      } catch (e) {
        console.warn('[push] register failed:', e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session?.access_token]);

  // Tap handling (foreground taps + cold-start tap).
  useEffect(() => {
    const Notifications = getNotifications();
    if (!Notifications) return;

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown> | undefined;
      navigateFromNotificationData(data);
    });

    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      const data = response.notification.request.content.data as Record<string, unknown> | undefined;
      navigateFromNotificationData(data);
    });

    return () => {
      sub.remove();
    };
  }, []);
}
