import { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import { salesApi } from '../../src/api';
import { useAuth } from '../../src/context/AuthContext';
import FaceCapture from '../../src/components/FaceCapture';
import { colors, shared } from '../../src/styles';

export default function CheckInScreen() {
  const { user } = useAuth();
  const [locations, setLocations] = useState<any[]>([]);
  const [selectedLoc, setSelectedLoc] = useState<string | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [loading, setLoading] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);

  useFocusEffect(useCallback(() => {
    salesApi.getLocations().then((r) => setLocations(r.data));
  }, []));

  const startCheckIn = async (locId: string) => {
    if (!user?.hasFaceEnrolled) {
      return Alert.alert('Face Not Enrolled', 'Please enroll your face in the Face ID tab first');
    }

    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return Alert.alert('Permission needed', 'Location permission required');

    setLoading(true);
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setCoords({ lat: loc.coords.latitude, lng: loc.coords.longitude });
      setSelectedLoc(locId);
      setShowCamera(true);
    } catch (err: any) {
      Alert.alert('GPS Error', err.message);
    } finally {
      setLoading(false);
    }
  };

  const onCapture = async (uri: string) => {
    if (!selectedLoc || !coords) return;
    setLoading(true);
    try {
      const { data } = await salesApi.checkIn(selectedLoc, coords.lat, coords.lng, uri);
      setShowCamera(false);
      Alert.alert(
        'Attendance Marked! ✅',
        `Face match: ${(data.face_similarity * 100).toFixed(0)}%\nDistance: ${data.distance_meters}m\nFollow-up in ~${data.follow_up_due_in_minutes} min`
      );
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message;
      const extra = err.response?.data?.distance_meters
        ? `\nYou are ${err.response.data.distance_meters}m away (max ${err.response.data.allowed_radius}m)`
        : '';
      Alert.alert('Check-in Failed', msg + extra);
      setShowCamera(false);
    } finally {
      setLoading(false);
    }
  };

  if (showCamera) {
    return (
      <FaceCapture
        title="Look at the camera to verify your identity"
        onCapture={onCapture}
        onCancel={() => setShowCamera(false)}
      />
    );
  }

  return (
    <View style={[shared.container, shared.content]}>
      <Text style={shared.title}>Mark Attendance</Text>
      <Text style={shared.subtitle}>Face + GPS verification within 100m of assigned location</Text>

      {loading && <ActivityIndicator color={colors.primary} style={{ marginVertical: 20 }} />}

      {locations.length === 0 ? (
        <Text style={{ color: colors.muted }}>No locations assigned. Contact your admin.</Text>
      ) : (
        locations.map((loc) => (
          <TouchableOpacity key={loc.id} style={shared.card} onPress={() => startCheckIn(loc.id)} disabled={loading}>
            <Text style={shared.cardTitle}>{loc.name}</Text>
            <Text style={shared.cardSub}>{loc.address}</Text>
            <Text style={{ color: colors.primary, marginTop: 8, fontWeight: '600' }}>Tap to Check In →</Text>
          </TouchableOpacity>
        ))
      )}
    </View>
  );
}
