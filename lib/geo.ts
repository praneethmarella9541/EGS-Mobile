import * as Location from 'expo-location';

/** Great-circle distance between two coordinates, in metres (haversine). */
export function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6371000; // earth radius (m)
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

/** Geocode an address to coordinates on-device (no API key). Throws if not found. */
export async function geocodeAddress(
  address: string
): Promise<{ lat: number; lng: number }> {
  const results = await Location.geocodeAsync(address.trim());
  if (!results.length) {
    throw new Error('Could not find that address. Try a more specific one.');
  }
  return { lat: results[0].latitude, lng: results[0].longitude };
}

/**
 * Ask for foreground location permission, then read the current position.
 * Rejects fake/mock locations (e.g. a "Fake GPS" app set as the device's
 * mock location provider via Developer Options) — Android reports this via
 * `mocked` on the result; there's no legitimate reason a real field visit
 * would need one, so any mocked reading is treated as a hard failure.
 * (iOS has no equivalent developer-options toggle, so `mocked` is always
 * undefined there — spoofing on iOS needs a jailbreak, out of scope here.)
 */
export async function getCurrentPosition(): Promise<{ lat: number; lng: number }> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('Location permission is required to verify attendance.');
  }
  const pos = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High,
  });
  if (pos.mocked) {
    throw new Error(
      'A fake/mock location app is turned on for this device. Turn off mock location in Developer Options and try again.'
    );
  }
  return { lat: pos.coords.latitude, lng: pos.coords.longitude };
}
