import { Platform } from 'react-native';
import Constants from 'expo-constants';

type NotificationsModule = typeof import('expo-notifications');

let notifications: NotificationsModule | null | undefined;
let handlerConfigured = false;

/** True when expo-notifications native code is linked in this binary (not Expo Go). */
export function isPushNativeAvailable(): boolean {
  return getNotifications() != null;
}

/** Android notification channel. Safe to call repeatedly. */
export async function ensureNotificationChannels(): Promise<void> {
  const Notifications = getNotifications();
  if (!Notifications || Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Assignments',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    sound: 'default',
  });
}

/**
 * expo-notifications is a native module — absent in Expo Go (SDK 53+ removed
 * remote push there). Load it defensively so importing this file never crashes
 * a screen; push simply no-ops until you run a dev build / standalone APK.
 */
export function getNotifications(): NotificationsModule | null {
  if (notifications !== undefined) return notifications;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    notifications = require('expo-notifications') as NotificationsModule;
    if (!handlerConfigured) {
      notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowAlert: true,
          shouldPlaySound: true,
          shouldSetBadge: true,
          shouldShowBanner: true,
          shouldShowList: true,
        }),
      });
      handlerConfigured = true;
    }
  } catch (e) {
    console.warn(
      '[push] expo-notifications not available — rebuild the dev client: npx expo run:android',
      e instanceof Error ? e.message : e
    );
    notifications = null;
  }
  return notifications;
}

function isPhysicalDevice(): boolean {
  if (Platform.OS === 'web') return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Device = require('expo-device') as typeof import('expo-device');
    return Device.isDevice;
  } catch {
    return Platform.OS === 'android' || Platform.OS === 'ios';
  }
}

/** Request permission and return this device's Expo push token (or null). */
export async function obtainExpoPushToken(): Promise<string | null> {
  const Notifications = getNotifications();
  if (!Notifications || !isPhysicalDevice()) return null;

  await ensureNotificationChannels();

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return null;

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;
  if (!projectId) {
    console.warn('[push] Missing EAS projectId in app.json extra.eas');
    return null;
  }

  try {
    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    return token.data;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/FirebaseApp|FCM|fcm-credentials/i.test(msg)) {
      console.warn('[push] Android FCM not configured — add google-services.json + FCM key in EAS, then rebuild.');
    } else {
      console.warn('[push] getExpoPushToken failed:', msg);
    }
    return null;
  }
}
