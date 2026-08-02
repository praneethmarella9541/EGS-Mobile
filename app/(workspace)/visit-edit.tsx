import React, { useEffect, useState } from 'react';
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
import { DictationNotesField } from '../../components/DictationNotesField';
import { Colors } from '../../constants/colors';
import { getVisit, updateVisit, deleteVisitPhoto, getPhotoUrls } from '../../lib/visits';
import type { LocationVisit, VisitPhoto } from '../../lib/types';

type ExistingPhoto = { photo: VisitPhoto; url: string | null };

/** Field user edits an already-logged visit's notes and photos (place/GPS are locked in). */
export default function VisitEditScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { visitId } = useLocalSearchParams<{ visitId: string }>();

  const [visit, setVisit] = useState<LocationVisit | null>(null);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState('');
  const [existingPhotos, setExistingPhotos] = useState<ExistingPhoto[]>([]);
  const [newPhotoUris, setNewPhotoUris] = useState<string[]>([]);
  const [removedPhotoIds, setRemovedPhotoIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const v = await getVisit(visitId);
        setVisit(v);
        setNotes(v.notes);
        const urls = await getPhotoUrls(v.photos.map((photo) => photo.photo_path));
        setExistingPhotos(v.photos.map((photo, i) => ({ photo, url: urls[i] })));
      } catch (e: any) {
        Alert.alert('Error', e?.message ?? 'Could not load this visit');
        router.back();
      } finally {
        setLoading(false);
      }
    })();
  }, [visitId]);

  function removeExistingPhoto(photoId: string) {
    setRemovedPhotoIds((prev) => new Set(prev).add(photoId));
  }

  function removeNewPhoto(uri: string) {
    setNewPhotoUris((prev) => prev.filter((p) => p !== uri));
  }

  async function takePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Camera needed', 'Allow camera access to attach a photo.');
      return;
    }
    const shot = await ImagePicker.launchCameraAsync({ quality: 0.5 });
    if (!shot.canceled && shot.assets?.[0]?.uri) {
      setNewPhotoUris((prev) => [...prev, shot.assets[0].uri]);
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
      setNewPhotoUris((prev) => [...prev, ...picked.assets.map((a) => a.uri)]);
    }
  }

  async function save() {
    Keyboard.dismiss();
    setSaving(true);
    try {
      const toRemove = existingPhotos.filter((p) => removedPhotoIds.has(p.photo.id));
      for (const p of toRemove) {
        await deleteVisitPhoto(p.photo);
      }
      await updateVisit(visitId, { notes, addPhotoUris: newPhotoUris });
      router.back();
    } catch (e: any) {
      Alert.alert('Could not save changes', e?.message ?? 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  if (loading || !visit) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  const visiblePhotos = existingPhotos.filter((p) => !removedPhotoIds.has(p.photo.id));

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior="padding"
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={26} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {visit.place_label}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <Text style={styles.fieldLabel}>Photos</Text>
        <View style={styles.photoRow}>
          {visiblePhotos.map(({ photo, url }) => (
            <View key={photo.id} style={styles.thumbWrap}>
              {url ? <Image source={{ uri: url }} style={styles.thumb} /> : <View style={styles.thumb} />}
              <TouchableOpacity style={styles.thumbRemove} onPress={() => removeExistingPhoto(photo.id)} hitSlop={6}>
                <Ionicons name="close-circle" size={20} color="#fff" />
              </TouchableOpacity>
            </View>
          ))}
          {newPhotoUris.map((uri) => (
            <View key={uri} style={styles.thumbWrap}>
              <Image source={{ uri }} style={styles.thumb} />
              <TouchableOpacity style={styles.thumbRemove} onPress={() => removeNewPhoto(uri)} hitSlop={6}>
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

        <TouchableOpacity style={[styles.submitBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>Save changes</Text>}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
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
