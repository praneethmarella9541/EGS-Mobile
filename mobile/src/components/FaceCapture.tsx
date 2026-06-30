import React, { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { prepareFacePhoto } from '../utils/prepareFacePhoto';

interface Props {
  onCapture: (uri: string) => void;
  onCancel?: () => void;
  title?: string;
}

export default function FaceCapture({ onCapture, onCancel, title = 'Position your face in the frame' }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState('');

  if (!permission) return <ActivityIndicator style={{ flex: 1 }} />;

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.msg}>Camera permission is required for face verification</Text>
        <TouchableOpacity style={styles.btn} onPress={requestPermission}>
          <Text style={styles.btnText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const capture = async () => {
    if (!cameraRef.current || capturing) return;
    setCapturing(true);
    setError('');
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 1,
        skipProcessing: false,
        shutterSound: false,
      });
      if (!photo?.uri) {
        setError('Could not capture photo. Please try again.');
        return;
      }
      const prepared = await prepareFacePhoto(photo.uri);
      onCapture(prepared);
    } catch {
      setError('Photo processing failed. Please try again with better lighting.');
    } finally {
      setCapturing(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.tips}>
        Tips: Good lighting • Remove glasses/mask • Face the camera • Fill the oval
      </Text>
      <View style={styles.cameraWrap}>
        <CameraView ref={cameraRef} style={styles.camera} facing="front" mirror />
        <View style={styles.faceOval} pointerEvents="none" />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <TouchableOpacity style={styles.btn} onPress={capture} disabled={capturing}>
        {capturing ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.btnText}>Capture Face</Text>
        )}
      </TouchableOpacity>
      {onCancel && (
        <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: '#0f172a' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  title: { color: '#e2e8f0', fontSize: 16, textAlign: 'center', marginBottom: 8 },
  tips: { color: '#94a3b8', fontSize: 12, textAlign: 'center', marginBottom: 12 },
  msg: { color: '#94a3b8', textAlign: 'center', marginBottom: 16 },
  error: { color: '#f87171', textAlign: 'center', marginBottom: 12, fontSize: 13 },
  cameraWrap: { flex: 1, borderRadius: 16, overflow: 'hidden', marginBottom: 16 },
  camera: { flex: 1 },
  faceOval: {
    position: 'absolute',
    top: '12%',
    left: '15%',
    right: '15%',
    bottom: '12%',
    borderWidth: 3,
    borderColor: '#3b82f6',
    borderRadius: 999,
  },
  btn: {
    backgroundColor: '#3b82f6',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  cancelBtn: { padding: 12, alignItems: 'center', marginTop: 8 },
  cancelText: { color: '#94a3b8' },
});
