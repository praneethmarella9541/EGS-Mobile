import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { nearbyPlaces } from '../lib/geo';

export type AddressPick = { label: string; lat: number; lng: number; placeId: string | null };

type Props = {
  value: string;
  onChangeText: (text: string) => void;
  onSelect: (pick: AddressPick) => void;
  placeholder?: string;
  /**
   * The device's location — required for category "near me" queries (e.g.
   * "preschools near me") to resolve at all; used as a ranking bias for plain
   * address/name search.
   */
  location?: { lat: number; lng: number } | null;
};

/** Either an Autocomplete prediction (needs a Place Details call to resolve
 *  coordinates) or a Nearby Search result (already has them). */
type SearchResult =
  | { source: 'autocomplete'; description: string; placeId: string }
  | { source: 'nearby'; label: string; detail: string; placeId: string | null; lat: number; lng: number };

const KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

// Google Places Autocomplete does not understand "near me" as a proximity
// instruction — confirmed by testing: it matches the phrase as literal text
// against place *names* ("apartments near me" surfaced a business literally
// named "Apartments Near Me" in Memphis, TN), and even a hard 50km radius
// filter returns ZERO results for a generic category term in a smaller town.
// Nearby Search (the same API "Fetch my location" already uses) is the actual
// right tool for category-near-me search — confirmed it returns real,
// correctly-local results where Autocomplete could not return any at all. So:
// detect this phrasing, strip it, and run a Nearby Search with the remainder
// as the keyword instead of an Autocomplete request.
const NEAR_ME_RE = /\b(near me|nearby|close to me|close by)\b/i;

/** Opaque session token to group autocomplete + details calls (Places billing). */
function newSessionToken(): string {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/**
 * Address/place search. Plain queries use Google Places Autocomplete (picking
 * a prediction resolves exact coordinates via Place Details). Category "near
 * me" queries ("preschools near me") instead run a Nearby Search keyword
 * search around `location`, which returns coordinates directly. Requires
 * EXPO_PUBLIC_GOOGLE_MAPS_API_KEY (Places API enabled).
 */
export function AddressAutocomplete({ value, onChangeText, onSelect, placeholder, location }: Props) {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [nearMeNoLocation, setNearMeNoLocation] = useState(false);
  const justPickedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<string>(newSessionToken());

  useEffect(() => {
    if (justPickedRef.current) {
      justPickedRef.current = false;
      return;
    }
    const q = value.trim();
    if (!KEY || q.length < 3) {
      setResults([]);
      setOpen(false);
      setNearMeNoLocation(false);
      return;
    }
    const t = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
      setNearMeNoLocation(false);
      try {
        const isNearMe = NEAR_ME_RE.test(q);
        const searchTerm = isNearMe ? q.replace(new RegExp(NEAR_ME_RE, 'gi'), ' ').trim() : q;
        if (!searchTerm) {
          setResults([]);
          setOpen(false);
          return;
        }

        if (isNearMe) {
          if (!location) {
            // Bias hasn't resolved yet (should be a moment — see
            // NearbyPlacePicker). Nothing sensible to search without it.
            setResults([]);
            setOpen(false);
            setNearMeNoLocation(true);
            return;
          }
          const places = await nearbyPlaces(location, { keyword: searchTerm, signal: ctrl.signal });
          const items: SearchResult[] = places.map((p) => ({
            source: 'nearby',
            label: p.label,
            detail: p.detail,
            placeId: p.placeId,
            lat: p.lat,
            lng: p.lng,
          }));
          setResults(items);
          setOpen(items.length > 0);
          return;
        }

        // Plain search — Autocomplete, soft-biased toward `location` if known
        // so a generic term still favors the right area without excluding an
        // exact match typed in full further away.
        const biasParams = location ? `&location=${location.lat},${location.lng}&radius=20000` : '';
        const url =
          `https://maps.googleapis.com/maps/api/place/autocomplete/json` +
          `?input=${encodeURIComponent(searchTerm)}&key=${KEY}` +
          `&sessiontoken=${sessionRef.current}&language=en${biasParams}`;
        const res = await fetch(url, { signal: ctrl.signal });
        const data = await res.json();
        if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
          console.warn('[places] autocomplete', data.status, data.error_message);
        }
        const items: SearchResult[] = (data.predictions ?? []).map(
          (p: any): SearchResult => ({
            source: 'autocomplete',
            description: p.description,
            placeId: p.place_id,
          })
        );
        setResults(items);
        setOpen(items.length > 0);
      } catch {
        /* aborted / network */
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
    // Re-run if the location bias arrives after the user already started
    // typing (it resolves in the background — see NearbyPlacePicker).
  }, [value, location?.lat, location?.lng]);

  async function pick(r: SearchResult) {
    justPickedRef.current = true;
    setResults([]);
    setOpen(false);

    if (r.source === 'nearby') {
      onChangeText(r.label);
      onSelect({ label: r.label, lat: r.lat, lng: r.lng, placeId: r.placeId });
      return;
    }

    onChangeText(r.description);
    try {
      const url =
        `https://maps.googleapis.com/maps/api/place/details/json` +
        `?place_id=${encodeURIComponent(r.placeId)}` +
        `&fields=geometry,formatted_address&key=${KEY}&sessiontoken=${sessionRef.current}`;
      const res = await fetch(url);
      const data = await res.json();
      const loc = data.result?.geometry?.location;
      if (loc) {
        onSelect({
          label: data.result.formatted_address || r.description,
          lat: loc.lat,
          lng: loc.lng,
          placeId: r.placeId,
        });
      }
    } catch {
      /* network — leave unpinned */
    } finally {
      // start a fresh billing session after a details lookup
      sessionRef.current = newSessionToken();
    }
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.inputRow}>
        <Ionicons name="location-outline" size={18} color={Colors.textMuted} />
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder ?? 'Search address…'}
          placeholderTextColor={Colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {loading && <ActivityIndicator size="small" color={Colors.primary} />}
      </View>

      {!KEY && value.trim().length >= 3 && (
        <Text style={styles.warn}>Set EXPO_PUBLIC_GOOGLE_MAPS_API_KEY to enable suggestions.</Text>
      )}

      {nearMeNoLocation && (
        <Text style={styles.warn}>Getting your location — try again in a moment.</Text>
      )}

      {open && (
        <View style={styles.dropdown}>
          {results.map((r, i) => (
            <TouchableOpacity
              key={r.source === 'nearby' ? (r.placeId ?? `nearby-${i}`) : r.placeId}
              style={[styles.item, i > 0 && styles.itemBorder]}
              onPress={() => pick(r)}
              activeOpacity={0.7}
            >
              <Ionicons
                name={r.source === 'nearby' ? 'business-outline' : 'navigate-outline'}
                size={15}
                color={Colors.textMuted}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.itemText} numberOfLines={2}>
                  {r.source === 'nearby' ? r.label : r.description}
                </Text>
                {r.source === 'nearby' && !!r.detail && (
                  <Text style={styles.itemDetail} numberOfLines={1}>
                    {r.detail}
                  </Text>
                )}
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative', zIndex: 10 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    backgroundColor: Colors.surface,
  },
  input: { flex: 1, paddingVertical: 12, fontSize: 15, color: Colors.text },
  warn: { fontSize: 11, color: Colors.warning, marginTop: 4 },
  dropdown: {
    marginTop: 4,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    overflow: 'hidden',
  },
  item: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12 },
  itemBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  itemText: { fontSize: 13, color: Colors.text },
  itemDetail: { fontSize: 11, color: Colors.textMuted, marginTop: 2 },
});
