import React, { useState } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { useAuth } from '../hooks/useAuth';
import { faceAuth } from '../lib/face-auth';

type Step = 'capture1' | 'capture2';

/**
 * Mandatory gate for field users before they can use the app. Captures two
 * selfies — the second cross-verifies the first via the face-api (the
 * "quality gate"). Nothing is persisted unless they match; a failed check
 * just resets back to step one so the user can retake both photos.
 */
export default function FaceRegistrationScreen() {
  const insets = useSafeAreaInsets();
  const { refreshProfile } = useAuth();
  const [step, setStep] = useState<Step>('capture1');
  const [photo1, setPhoto1] = useState<string | null>(null);
  const [photo2, setPhoto2] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function capture(): Promise<string | null> {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Camera needed', 'Allow camera access to register your face.');
      return null;
    }
    const shot = await ImagePicker.launchCameraAsync({ quality: 0.5, cameraType: ImagePicker.CameraType.front });
    if (shot.canceled || !shot.assets?.[0]?.uri) return null;
    return shot.assets[0].uri;
  }

  async function captureFirst() {
    const uri = await capture();
    if (uri) setPhoto1(uri);
  }

  async function captureSecond() {
    const uri = await capture();
    if (uri) setPhoto2(uri);
  }

  function reset() {
    setPhoto1(null);
    setPhoto2(null);
    setStep('capture1');
  }

  async function confirm() {
    if (!photo1 || !photo2) return;
    setBusy(true);
    try {
      const result = await faceAuth.register(photo1, photo2);
      if (result.ok) {
        await refreshProfile();
      } else {
        Alert.alert(
          "Didn't match",
          `These two photos don't look like the same person clearly enough (similarity ${result.similarity.toFixed(
            2
          )}, needed ${result.threshold.toFixed(2)}). Please retake both in good lighting.`
        );
        reset();
      }
    } catch (e: any) {
      Alert.alert('Registration failed', e?.message ?? 'Please try again.');
      reset();
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      <Ionicons name="person-circle-outline" size={56} color={Colors.primary} />
      <Text style={styles.title}>Register your face</Text>
      <Text style={styles.subtitle}>
        Before you can check in to assignments, we need to register your face. Take two clear selfies —
        we'll use these to verify it's really you at check-in time.
      </Text>

      {step === 'capture1' || !photo1 ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>1. Take a clear selfie</Text>
          {photo1 ? (
            <>
              <Image source={{ uri: photo1 }} style={styles.preview} />
              <View style={styles.row}>
                <TouchableOpacity style={styles.secondaryBtn} onPress={captureFirst}>
                  <Text style={styles.secondaryBtnText}>Retake</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.primaryBtn} onPress={() => setStep('capture2')}>
                  <Text style={styles.primaryBtnText}>Continue</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <TouchableOpacity style={styles.captureBtn} onPress={captureFirst}>
              <Ionicons name="camera-outline" size={20} color="#fff" />
              <Text style={styles.primaryBtnText}>Take photo</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>2. Take one more, for verification</Text>
          {photo2 ? (
            <>
              <Image source={{ uri: photo2 }} style={styles.preview} />
              <View style={styles.row}>
                <TouchableOpacity style={styles.secondaryBtn} onPress={captureSecond} disabled={busy}>
                  <Text style={styles.secondaryBtnText}>Retake</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.primaryBtn, busy && { opacity: 0.6 }]} onPress={confirm} disabled={busy}>
                  {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Confirm & register</Text>}
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <TouchableOpacity style={styles.captureBtn} onPress={captureSecond}>
              <Ionicons name="camera-outline" size={20} color="#fff" />
              <Text style={styles.primaryBtnText}>Take photo</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    paddingHorizontal: 24,
    gap: 12,
  },
  title: { fontSize: 20, fontWeight: '700', color: Colors.text, marginTop: 8 },
  subtitle: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  card: {
    width: '100%',
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 18,
    gap: 14,
    marginTop: 16,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: Colors.text },
  preview: { width: '100%', height: 240, borderRadius: 12, backgroundColor: Colors.borderLight },
  row: { flexDirection: 'row', gap: 10 },
  captureBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 11,
    paddingVertical: 14,
  },
  primaryBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    borderRadius: 11,
    paddingVertical: 13,
  },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  secondaryBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 11,
    paddingVertical: 13,
  },
  secondaryBtnText: { color: Colors.textSecondary, fontSize: 15, fontWeight: '700' },
});
