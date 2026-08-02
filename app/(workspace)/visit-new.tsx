import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  KeyboardAvoidingView,
  Keyboard,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { NearbyPlacePicker, type PlacePick } from '../../components/NearbyPlacePicker';
import { DictationNotesField } from '../../components/DictationNotesField';
import { ChooseFormSheet, type ChooseableForm } from '../../components/ChooseFormSheet';
import { Colors } from '../../constants/colors';
import { getCurrentPosition } from '../../lib/geo';
import { createVisit } from '../../lib/visits';
import { getAssignmentById } from '../../lib/assignments';
import { resolveAssignmentForms } from '../../lib/settings';

/**
 * Field user logs one specific place within their assigned area: they fetch
 * their location and pick the building/school they're at from what's around
 * them (see NearbyPlacePicker), then must still be within GEO_RADIUS_M of it
 * when they submit — plus bulk photos and notes.
 */
export default function VisitNewScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { assignmentId, areaLabel } = useLocalSearchParams<{
    assignmentId: string;
    areaLabel: string;
    assignedDate: string;
  }>();

  const [place, setPlace] = useState<PlacePick | null>(null);
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  // Non-null (2+) after logging a visit whose area has multiple forms attached
  // — the ChooseFormSheet lets the user pick one to open right away.
  const [chooseForms, setChooseForms] = useState<ChooseableForm[] | null>(null);

  async function takePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Camera needed', 'Allow camera access to attach a photo.');
      return;
    }
    const shot = await ImagePicker.launchCameraAsync({ quality: 0.5 });
    if (!shot.canceled && shot.assets?.[0]?.uri) {
      setPhotos((prev) => [...prev, shot.assets[0].uri]);
    }
  }

  async function choosePhotos() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Photos needed', 'Allow photo library access to attach photos.');
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.5,
    });
    if (!picked.canceled && picked.assets?.length) {
      setPhotos((prev) => [...prev, ...picked.assets.map((a) => a.uri)]);
    }
  }

  function removePhoto(uri: string) {
    setPhotos((prev) => prev.filter((p) => p !== uri));
  }

  async function submit() {
    Keyboard.dismiss();
    if (!place) {
      return Alert.alert(
        'Pick a place',
        'Tap "Fetch my location" and choose the building you\'re at so we can record where this visit happened.'
      );
    }
    if (!place.label.trim()) {
      return Alert.alert('Name this place', 'The place name can\'t be empty.');
    }

    setSaving(true);
    try {
      // Fetch the assignment fresh (rather than trusting route params) so we
      // get its up-to-date attached forms, not just what was true when this
      // screen was opened.
      const assignment = await getAssignmentById(assignmentId);
      // Re-read GPS rather than reusing the fix the place was fetched with —
      // that's what makes the geofence check below mean anything.
      const device = await getCurrentPosition();
      await createVisit({
        assignment,
        placeLabel: place.label,
        addressLat: place.lat,
        addressLng: place.lng,
        deviceLat: device.lat,
        deviceLng: device.lng,
        notes,
        photoUris: photos,
        placeId: place.placeId,
        placeSource: place.source,
        labelEdited: place.labelEdited,
        gpsAccuracyM: place.gpsAccuracyM ?? device.accuracyM,
        fetchedAt: place.fetchedAt,
      });
      const fields = await resolveAssignmentForms(assignment);
      if (fields.length === 1) {
        router.replace({
          pathname: '/(workspace)/form-view',
          params: { url: fields[0].url, title: place.label },
        } as any);
      } else if (fields.length === 0) {
        Alert.alert('Visit logged', 'No field form is set yet — ask your admin to set one in the Forms tab.', [
          { text: 'OK', onPress: () => router.back() },
        ]);
      } else {
        // Multiple forms attached to this area — let the user pick one to
        // open now; the rest (and this one) stay available on the task list.
        setChooseForms(fields);
      }
    } catch (e: any) {
      Alert.alert('Could not log visit', e?.message ?? 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior="padding"
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={26} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {areaLabel || 'Log a visit'}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <Text style={styles.fieldLabel}>Place</Text>
        <NearbyPlacePicker value={place} onChange={setPlace} />
        {place ? (
          <Text style={styles.pickedOk}>✓ Place pinned — we'll re-check your location when you submit.</Text>
        ) : (
          <Text style={styles.hint}>Fetch your location and pick the building you're visiting.</Text>
        )}

        <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Photos</Text>
        <View style={styles.photoRow}>
          {photos.map((uri) => (
            <View key={uri} style={styles.thumbWrap}>
              <Image source={{ uri }} style={styles.thumb} />
              <TouchableOpacity style={styles.thumbRemove} onPress={() => removePhoto(uri)} hitSlop={6}>
                <Ionicons name="close-circle" size={20} color="#fff" />
              </TouchableOpacity>
            </View>
          ))}
        </View>
        <View style={styles.mediaBtns}>
          <TouchableOpacity style={styles.mediaBtn} onPress={takePhoto}>
            <Ionicons name="camera-outline" size={18} color={Colors.primary} />
            <Text style={styles.mediaBtnText}>Take photo</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.mediaBtn} onPress={choosePhotos}>
            <Ionicons name="images-outline" size={18} color={Colors.primary} />
            <Text style={styles.mediaBtnText}>Choose photos</Text>
          </TouchableOpacity>
        </View>

        <DictationNotesField value={notes} onChangeText={setNotes} placeholder="Any details about this visit…" />

        <TouchableOpacity
          style={[styles.submitBtn, saving && { opacity: 0.6 }]}
          onPress={submit}
          disabled={saving}
        >
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>Log visit</Text>}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>

    <ChooseFormSheet
      visible={chooseForms !== null}
      forms={chooseForms ?? []}
      onPick={(f) => {
        setChooseForms(null);
        router.replace({
          pathname: '/(workspace)/form-view',
          params: { url: f.url, title: place?.label ?? '' },
        } as any);
      }}
      onClose={() => {
        setChooseForms(null);
        router.replace('/(workspace)/tasks' as any);
      }}
    />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingBottom: 12,
    backgroundColor: Colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: '700', color: Colors.text },
  form: { padding: 16, paddingBottom: 40 },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom: 6,
  },
  hint: { fontSize: 12, color: Colors.textMuted, marginTop: 4 },
  pickedOk: { fontSize: 12, color: Colors.success, fontWeight: '600', marginTop: 4 },
  photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  thumbWrap: { position: 'relative' },
  thumb: { width: 72, height: 72, borderRadius: 10, backgroundColor: Colors.borderLight },
  thumbRemove: { position: 'absolute', top: -6, right: -6 },
  mediaBtns: { flexDirection: 'row', gap: 10, marginTop: 10 },
  mediaBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingVertical: 11,
    backgroundColor: Colors.surface,
  },
  mediaBtnText: { fontSize: 13, fontWeight: '600', color: Colors.primary },
  submitBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 20,
  },
  submitBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
