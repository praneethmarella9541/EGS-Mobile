import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Wipe per-user/session data so a new login never sees the previous account.
 * Extend this as feature modules add their own caches.
 */
export async function resetAppSessionCaches(userId?: string): Promise<void> {
  // No feature caches yet. Keep auth/session keys managed by Supabase intact;
  // only clear app-owned scratch keys here as modules are added.
  void userId;
  await Promise.resolve();
  void AsyncStorage;
}
