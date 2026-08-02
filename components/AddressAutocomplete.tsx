import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';

export type AddressPick = { label: string; lat: number; lng: number; placeId: string | null };

type Props = {
  value: string;
  onChangeText: (text: string) => void;
  onSelect: (pick: AddressPick) => void;
  placeholder?: string;
};

type Prediction = { description: string; place_id: string };

const KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

/** Opaque session token to group autocomplete + details calls (Places billing). */
function newSessionToken(): string {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/**
 * Address input with Google Places Autocomplete. Picking a prediction calls
 * Place Details to resolve exact coordinates. Requires
 * EXPO_PUBLIC_GOOGLE_MAPS_API_KEY (Places API enabled).
 */
export function AddressAutocomplete({ value, onChangeText, onSelect, placeholder }: Props) {
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
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
      setPredictions([]);
      setOpen(false);
      return;
    }
    const t = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
      try {
        const url =
          `https://maps.googleapis.com/maps/api/place/autocomplete/json` +
          `?input=${encodeURIComponent(q)}&key=${KEY}` +
          `&sessiontoken=${sessionRef.current}&language=en`;
        const res = await fetch(url, { signal: ctrl.signal });
        const data = await res.json();
        if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
          console.warn('[places] autocomplete', data.status, data.error_message);
        }
        const items: Prediction[] = (data.predictions ?? []).map((p: any) => ({
          description: p.description,
          place_id: p.place_id,
        }));
        setPredictions(items);
        setOpen(items.length > 0);
      } catch {
        /* aborted / network */
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [value]);

  async function pick(p: Prediction) {
    justPickedRef.current = true;
    onChangeText(p.description);
    setPredictions([]);
    setOpen(false);
    try {
      const url =
        `https://maps.googleapis.com/maps/api/place/details/json` +
        `?place_id=${encodeURIComponent(p.place_id)}` +
        `&fields=geometry,formatted_address&key=${KEY}&sessiontoken=${sessionRef.current}`;
      const res = await fetch(url);
      const data = await res.json();
      const loc = data.result?.geometry?.location;
      if (loc) {
        onSelect({
          label: data.result.formatted_address || p.description,
          lat: loc.lat,
          lng: loc.lng,
          placeId: p.place_id,
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

      {open && (
        <View style={styles.dropdown}>
          {predictions.map((p, i) => (
            <TouchableOpacity
              key={p.place_id}
              style={[styles.item, i > 0 && styles.itemBorder]}
              onPress={() => pick(p)}
              activeOpacity={0.7}
            >
              <Ionicons name="navigate-outline" size={15} color={Colors.textMuted} />
              <Text style={styles.itemText} numberOfLines={2}>
                {p.description}
              </Text>
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
  itemText: { flex: 1, fontSize: 13, color: Colors.text },
});
