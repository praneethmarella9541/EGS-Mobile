import { useState } from 'react';
import { View, Text, Alert, ActivityIndicator } from 'react-native';
import { useAuth } from '../../src/context/AuthContext';
import { authApi } from '../../src/api';
import FaceCapture from '../../src/components/FaceCapture';
import { colors, shared } from '../../src/styles';

export default function EnrollFaceScreen() {
  const { user, refreshUser } = useAuth();
  const [loading, setLoading] = useState(false);

  const onCapture = async (uri: string) => {
    setLoading(true);
    try {
      await authApi.enrollFace(uri);
      await refreshUser();
      Alert.alert('Success', 'Your face has been enrolled. You can now mark attendance.');
    } catch (err: any) {
      Alert.alert('Enrollment Failed', err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={[shared.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={{ color: colors.muted, marginTop: 12 }}>Processing face...</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {user?.hasFaceEnrolled && (
        <View style={{ padding: 16, backgroundColor: colors.success + '22' }}>
          <Text style={{ color: colors.success, textAlign: 'center' }}>✅ Face already enrolled. Capture again to update.</Text>
        </View>
      )}
      <FaceCapture
        title="Enroll your face for attendance verification"
        onCapture={onCapture}
      />
    </View>
  );
}
