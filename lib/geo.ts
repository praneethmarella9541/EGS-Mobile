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
export async function getCurrentPosition(): Promise<{
  lat: number;
  lng: number;
  /** Reported horizontal accuracy in metres; null if the platform withholds it. */
  accuracyM: number | null;
}> {
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
  return {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracyM: pos.coords.accuracy ?? null,
  };
}

/**
 * Best-effort, near-instant last-known device location — no fresh GPS
 * acquisition, no permission prompt (only used if already granted). Purely to
 * bias text search results toward "near me" so category queries like
 * "preschools near me" actually rank nearby matches first, the way Google
 * Maps' own search bar does. Never used for anything requiring accuracy or
 * the visit's actual recorded location — returns null on any failure, and
 * callers degrade to an unbiased search.
 */
export async function getLastKnownPosition(): Promise<{ lat: number; lng: number } | null> {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    const pos = await Location.getLastKnownPositionAsync();
    if (!pos) return null;
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  } catch {
    return null;
  }
}

const MAPS_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

/** A place offered to the user after fetching their location. */
export type NearbyPlace = {
  /** Google place_id, or null for the reverse-geocoded street address. */
  placeId: string | null;
  label: string;
  /** Secondary line — vicinity for POIs, empty for the street address. */
  detail: string;
  lat: number;
  lng: number;
  /** Metres from the GPS fix the lookup was made with. */
  distanceM: number;
  source: 'nearby' | 'reverse_geocode';
};

/**
 * Named establishments (schools, buildings, offices) around a GPS fix, nearest
 * first. This is what makes "fetch my location" usable for field work: a visit
 * needs to be recorded against *"ZPHS Kondapur"*, and reverse geocoding only
 * ever returns a postal address. Failures are non-fatal — callers fall back to
 * the reverse-geocoded address or to manual search.
 *
 * Also what powers category "near me" search (see AddressAutocomplete) — Place
 * Autocomplete cannot do this at all: it treats "near me" as literal text to
 * match against place *names* rather than a proximity instruction, and even a
 * hard 50km radius filter returns zero results for a category term in a
 * smaller town. Nearby Search with a `keyword` is the actual right tool —
 * confirmed it returns real, correctly-local results where Autocomplete could
 * not return any.
 *
 * `rankby=distance` is mutually exclusive with `radius` and requires a
 * type/keyword, hence `type=establishment` (the broadest one available).
 */
export async function nearbyPlaces(
  at: { lat: number; lng: number },
  opts?: { keyword?: string; signal?: AbortSignal }
): Promise<NearbyPlace[]> {
  if (!MAPS_KEY) return [];
  const keywordParam = opts?.keyword ? `&keyword=${encodeURIComponent(opts.keyword)}` : '';
  const url =
    `https://maps.googleapis.com/maps/api/place/nearbysearch/json` +
    `?location=${at.lat},${at.lng}&rankby=distance&type=establishment${keywordParam}` +
    `&key=${MAPS_KEY}&language=en`;
  const res = await fetch(url, { signal: opts?.signal });
  const data = await res.json();
  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    console.warn('[places] nearbysearch', data.status, data.error_message);
    return [];
  }
  return (data.results ?? [])
    .map((r: any): NearbyPlace | null => {
      const loc = r.geometry?.location;
      if (!loc || !r.name) return null;
      return {
        placeId: r.place_id ?? null,
        label: r.name,
        detail: r.vicinity ?? '',
        lat: loc.lat,
        lng: loc.lng,
        distanceM: distanceMeters(at, { lat: loc.lat, lng: loc.lng }),
        source: 'nearby' as const,
      };
    })
    .filter((p: NearbyPlace | null): p is NearbyPlace => p !== null)
    .sort((a: NearbyPlace, b: NearbyPlace) => a.distanceM - b.distanceM);
}

/**
 * The street address at a GPS fix. Offered as the last option under the nearby
 * buildings — in villages and open ground there is often no mapped
 * establishment, and an address is the only thing that exists. Returns null
 * rather than throwing so a failed lookup just drops the option.
 */
export async function reverseGeocode(
  at: { lat: number; lng: number },
  signal?: AbortSignal
): Promise<NearbyPlace | null> {
  if (!MAPS_KEY) return null;
  const url =
    `https://maps.googleapis.com/maps/api/geocode/json` +
    `?latlng=${at.lat},${at.lng}&key=${MAPS_KEY}&language=en`;
  const res = await fetch(url, { signal });
  const data = await res.json();
  if (data.status !== 'OK' || !data.results?.length) {
    if (data.status !== 'ZERO_RESULTS') {
      console.warn('[geocode] reverse', data.status, data.error_message);
    }
    return null;
  }
  const top = data.results[0];
  return {
    placeId: null, // an address, not a place we want to key visits on
    label: top.formatted_address,
    detail: '',
    lat: at.lat,
    lng: at.lng,
    distanceM: 0,
    source: 'reverse_geocode',
  };
}
