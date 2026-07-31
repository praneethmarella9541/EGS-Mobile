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
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { AddressAutocomplete, type AddressPick } from '../../components/AddressAutocomplete';
import { DictationNotesField } from '../../components/DictationNotesField';
import { Colors } from '../../constants/colors';
import { getCurrentPosition } from '../../lib/geo';
import { createVisit } from '../../lib/visits';
import { resolveAssignmentForm } from '../../lib/settings';
import type { Assignment } from '../../lib/types';

/**
 * Field user logs one specific place within their assigned area: they type/pick
 * the address, and must be within GEO_RADIUS_M of it (live GPS vs the picked
 * address) to log it — plus bulk photos and notes.
 */
export default function VisitNewScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { assignmentId, areaLabel, assignedDate, formId, formUrl } = useLocalSearchParams<{
    assignmentId: string;
    areaLabel: string;
    assignedDate: string;
    formId?: string;
    formUrl?: string;
  }>();

  const [place, setPlace] = useState('');
  const [addressPick, setAddressPick] = useState<AddressPick | null>(null);
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  function onPlaceChange(text: string) {
    setPlace(text);
    // Typing invalidates any previously picked coordinates — must re-pick to geofence.
    setAddressPick(null);
  }

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
    if (!addressPick) {
      return Alert.alert(
        'Pick an address',
        'Search and select the exact address from the suggestions so we can verify your location.'
      );
    }

    const assignment: Assignment = {
      id: assignmentId,
      user_id: '',
      assigned_date: assignedDate,
      area_label: areaLabel,
      form_id: formId || null,
      form_url: formUrl || null,
      created_by: '',
      created_at: '',
    };

    setSaving(true);
    try {
      const device = await getCurrentPosition();
      await createVisit({
        assignment,
        placeLabel: addressPick.label,
        addressLat: addressPick.lat,
        addressLng: addressPick.lng,
        deviceLat: device.lat,
        deviceLng: device.lng,
        notes,
        photoUris: photos,
      });
      const field = await resolveAssignmentForm(assignment);
      if (field) {
        router.replace({
          pathname: '/(workspace)/form-view',
          params: { url: field.url, title: addressPick.label },
        } as any);
      } else {
        Alert.alert('Visit logged', 'No field form is set yet — ask your admin to set one in the Forms tab.', [
          { text: 'OK', onPress: () => router.back() },
        ]);
      }
    } catch (e: any) {
      Alert.alert('Could not log visit', e?.message ?? 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
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
        <AddressAutocomplete
          value={place}
          onChangeText={onPlaceChange}
          onSelect={(pick) => {
            setPlace(pick.label);
            setAddressPick(pick);
          }}
          placeholder="Search the exact address you're at…"
        />
        {addressPick ? (
          <Text style={styles.pickedOk}>✓ Address pinned — we'll check you're nearby when you submit.</Text>
        ) : (
          <Text style={styles.hint}>Pick a suggestion so we can verify you're actually there.</Text>
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
