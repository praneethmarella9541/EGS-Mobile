import React, { useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AddressAutocomplete, type AddressPick } from './AddressAutocomplete';
import { Colors } from '../constants/colors';
import {
  getCurrentPosition,
  getLastKnownPosition,
  nearbyPlaces,
  reverseGeocode,
  type NearbyPlace,
} from '../lib/geo';
import { GPS_ACCURACY_MAX_M, GPS_ACCURACY_WARN_M, type PlaceSource } from '../lib/types';

/**
 * A place chosen for a visit. `lat`/`lng` are always machine-captured — from the
 * GPS fix or from Google — and can never be typed by the user; only `label` is
 * editable. `labelEdited` records when they did.
 */
export type PlacePick = {
  placeId: string | null;
  label: string;
  lat: number;
  lng: number;
  source: PlaceSource;
  labelEdited: boolean;
  gpsAccuracyM: number | null;
  /** ISO time of the GPS fix this pick came from; null when hand-searched. */
  fetchedAt: string | null;
};

type Props = {
  value: PlacePick | null;
  onChange: (pick: PlacePick | null) => void;
};

type Mode = 'idle' | 'fetching' | 'choosing' | 'manual';

/**
 * Captures the place for a visit from the device's live GPS: one tap fetches the
 * user's position and lists the named buildings/schools around them to pick
 * from, with the reverse-geocoded street address as a fallback option for spots
 * with nothing mapped nearby, and manual search as the last resort.
 *
 * Replaces typing an address by hand, which made the coordinates user-supplied.
 * The name Google returns is often not what the place is locally called, so the
 * picked label stays editable — but editing text never moves the pin.
 */
export function NearbyPlacePicker({ value, onChange }: Props) {
  const [mode, setMode] = useState<Mode>('idle');
  const [options, setOptions] = useState<NearbyPlace[]>([]);
  const [accuracyM, setAccuracyM] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualText, setManualText] = useState('');
  // Location bias for manual search ("preschools near me" etc.) — filled in
  // from a real GPS fix if one was already taken, else a best-effort
  // last-known position fetched silently when manual search is opened.
  const [searchBias, setSearchBias] = useState<{ lat: number; lng: number } | null>(null);
  /** The label as fetched, to detect the user typing over it. */
  const originalLabel = useRef('');
  /** Provenance of the fix the current list was built from, stamped onto the pick. */
  const fixRef = useRef<{ fetchedAt: string; accuracyM: number | null }>({
    fetchedAt: '',
    accuracyM: null,
  });

  async function fetchLocation() {
    setMode('fetching');
    setError(null);
    setOptions([]);
    try {
      const fix = await getCurrentPosition();
      const fetchedAt = new Date().toISOString();
      setAccuracyM(fix.accuracyM);
      // Even a loose fix is fine as a search bias — it only needs to be in the
      // right neighborhood, unlike the visit's actual recorded location.
      setSearchBias({ lat: fix.lat, lng: fix.lng });

      if (fix.accuracyM !== null && fix.accuracyM > GPS_ACCURACY_MAX_M) {
        setError(
          `Your location is only accurate to about ${Math.round(fix.accuracyM)} m, so we can't tell which building you're at. ` +
            `Step outside or into the open and try again.`
        );
        setMode('idle');
        return;
      }

      const [places, address] = await Promise.all([
        nearbyPlaces(fix).catch(() => [] as NearbyPlace[]),
        reverseGeocode(fix).catch(() => null),
      ]);

      const list = [...places.slice(0, 8), ...(address ? [address] : [])];
      if (list.length === 0) {
        setError("We couldn't find anything mapped around you. Search for the place instead.");
        setMode('manual');
        return;
      }

      fixRef.current = { fetchedAt, accuracyM: fix.accuracyM };
      setOptions(list);
      setMode('choosing');
    } catch (e: any) {
      setError(e?.message ?? 'Could not read your location.');
      setMode('idle');
    }
  }

  function choose(p: NearbyPlace) {
    originalLabel.current = p.label;
    onChange({
      placeId: p.placeId,
      label: p.label,
      lat: p.lat,
      lng: p.lng,
      source: p.source,
      labelEdited: false,
      gpsAccuracyM: fixRef.current.accuracyM,
      fetchedAt: fixRef.current.fetchedAt || null,
    });
    setMode('idle');
  }

  function chooseManual(pick: AddressPick) {
    originalLabel.current = pick.label;
    onChange({
      placeId: pick.placeId,
      label: pick.label,
      lat: pick.lat,
      lng: pick.lng,
      source: 'manual_search',
      labelEdited: false,
      gpsAccuracyM: null,
      fetchedAt: null,
    });
    setManualText('');
    setMode('idle');
  }

  /**
   * Switch to manual search, grabbing a location bias in the background if we
   * don't already have one (e.g. skipped straight here without ever fetching
   * GPS) — see AddressAutocomplete's `location` prop.
   *
   * Two-step: the cached last-known position lands almost instantly so search
   * feels responsive right away, but it can be stale — sometimes from
   * wherever the device last took a real fix, a different city entirely, with
   * no visible error. So it's immediately followed by a real GPS read, which
   * corrects the bias once it resolves (typically a couple of seconds).
   */
  function enterManualSearch() {
    setMode('manual');
    if (searchBias) return;
    void getLastKnownPosition().then((pos) => {
      if (pos) setSearchBias(pos);
    });
    getCurrentPosition()
      .then((fix) => setSearchBias({ lat: fix.lat, lng: fix.lng }))
      .catch(() => {
        /* no permission / no fix — keep the last-known bias, if any */
      });
  }

  function editLabel(text: string) {
    if (!value) return;
    onChange({ ...value, label: text, labelEdited: text.trim() !== originalLabel.current.trim() });
  }

  function reset() {
    onChange(null);
    setOptions([]);
    setError(null);
    setMode('idle');
  }

  // ── Picked: show the label (editable) and how it was captured ──────────────
  if (value) {
    const loose = value.gpsAccuracyM !== null && value.gpsAccuracyM > GPS_ACCURACY_WARN_M;
    return (
      <View style={styles.wrap}>
        <View style={styles.pickedCard}>
          <View style={styles.pickedTop}>
            <Ionicons name="business-outline" size={18} color={Colors.primary} />
            <TextInput
              style={styles.pickedInput}
              value={value.label}
              onChangeText={editLabel}
              multiline
              placeholder="Name of this place"
              placeholderTextColor={Colors.textMuted}
            />
          </View>
          <View style={styles.pickedMeta}>
            <Text style={styles.metaText}>
              {value.source === 'manual_search'
                ? 'Searched by hand'
                : value.source === 'reverse_geocode'
                  ? 'Address at your location'
                  : 'Picked from places around you'}
              {value.gpsAccuracyM !== null && ` · GPS ±${Math.round(value.gpsAccuracyM)} m`}
            </Text>
            <TouchableOpacity onPress={reset} hitSlop={8}>
              <Text style={styles.changeLink}>Change</Text>
            </TouchableOpacity>
          </View>
        </View>
        {value.labelEdited && (
          <Text style={styles.hint}>
            Name edited — your recorded location is unchanged.
          </Text>
        )}
        {loose && (
          <Text style={styles.warn}>
            Your GPS fix is loose (±{Math.round(value.gpsAccuracyM!)} m) — make sure this is the right place.
          </Text>
        )}
      </View>
    );
  }

  // ── Manual search fallback ────────────────────────────────────────────────
  if (mode === 'manual') {
    return (
      <View style={styles.wrap}>
        <AddressAutocomplete
          value={manualText}
          onChangeText={setManualText}
          onSelect={chooseManual}
          placeholder="Search for the place… e.g. preschools near me"
          location={searchBias}
        />
        <TouchableOpacity onPress={() => setMode('idle')} style={styles.linkBtn}>
          <Ionicons name="locate-outline" size={15} color={Colors.primary} />
          <Text style={styles.linkBtnText}>Use my location instead</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Choosing from the fetched list ────────────────────────────────────────
  if (mode === 'choosing') {
    return (
      <View style={styles.wrap}>
        <View style={styles.accuracyRow}>
          <Ionicons
            name={accuracyM !== null && accuracyM > GPS_ACCURACY_WARN_M ? 'warning-outline' : 'checkmark-circle'}
            size={15}
            color={accuracyM !== null && accuracyM > GPS_ACCURACY_WARN_M ? Colors.warning : Colors.success}
          />
          <Text style={styles.accuracyText}>
            {accuracyM !== null ? `Location found · accurate to ±${Math.round(accuracyM)} m` : 'Location found'}
          </Text>
          <TouchableOpacity onPress={fetchLocation} hitSlop={8}>
            <Text style={styles.changeLink}>Retry</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.dropdown}>
          {options.map((p, i) => (
            <TouchableOpacity
              key={`${p.placeId ?? 'addr'}-${i}`}
              style={[styles.item, i > 0 && styles.itemBorder]}
              onPress={() => choose(p)}
              activeOpacity={0.7}
            >
              <Ionicons
                name={p.source === 'reverse_geocode' ? 'map-outline' : 'business-outline'}
                size={16}
                color={Colors.textMuted}
              />
              <View style={styles.itemBody}>
                <Text style={styles.itemText} numberOfLines={2}>
                  {p.label}
                </Text>
                {!!p.detail && (
                  <Text style={styles.itemDetail} numberOfLines={1}>
                    {p.detail}
                  </Text>
                )}
              </View>
              <Text style={styles.itemDistance}>
                {p.source === 'reverse_geocode' ? 'address' : `${p.distanceM} m`}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity onPress={enterManualSearch} style={styles.linkBtn}>
          <Ionicons name="search-outline" size={15} color={Colors.primary} />
          <Text style={styles.linkBtnText}>Not listed — search for it</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Idle / fetching ───────────────────────────────────────────────────────
  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        style={[styles.fetchBtn, mode === 'fetching' && { opacity: 0.6 }]}
        onPress={fetchLocation}
        disabled={mode === 'fetching'}
        activeOpacity={0.8}
      >
        {mode === 'fetching' ? (
          <>
            <ActivityIndicator size="small" color={Colors.primary} />
            <Text style={styles.fetchBtnText}>Finding places around you…</Text>
          </>
        ) : (
          <>
            <Ionicons name="locate" size={18} color={Colors.primary} />
            <Text style={styles.fetchBtnText}>Fetch my location</Text>
          </>
        )}
      </TouchableOpacity>

      {error && <Text style={styles.error}>{error}</Text>}

      {mode !== 'fetching' && (
        <TouchableOpacity onPress={enterManualSearch} style={styles.linkBtn}>
          <Ionicons name="search-outline" size={15} color={Colors.primary} />
          <Text style={styles.linkBtnText}>Search for the place instead</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative', zIndex: 10 },
  fetchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 14,
    backgroundColor: Colors.primaryLight,
  },
  fetchBtnText: { fontSize: 15, fontWeight: '700', color: Colors.primary },
  linkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    marginTop: 2,
  },
  linkBtnText: { fontSize: 13, fontWeight: '600', color: Colors.primary },
  accuracyRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  accuracyText: { flex: 1, fontSize: 12, color: Colors.textMuted },
  changeLink: { fontSize: 13, fontWeight: '600', color: Colors.primary },
  dropdown: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    overflow: 'hidden',
  },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  itemBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  itemBody: { flex: 1 },
  itemText: { fontSize: 14, color: Colors.text, fontWeight: '500' },
  itemDetail: { fontSize: 11, color: Colors.textMuted, marginTop: 2 },
  itemDistance: { fontSize: 11, color: Colors.textMuted, fontVariant: ['tabular-nums'] },
  pickedCard: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  pickedTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  pickedInput: { flex: 1, fontSize: 15, color: Colors.text, padding: 0, minHeight: 20 },
  pickedMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  metaText: { flex: 1, fontSize: 11, color: Colors.textMuted },
  hint: { fontSize: 12, color: Colors.textMuted, marginTop: 6 },
  warn: { fontSize: 12, color: Colors.warning, marginTop: 6 },
  error: { fontSize: 12, color: Colors.error, marginTop: 8, lineHeight: 17 },
});
