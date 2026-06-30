import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, RefreshControl } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { salesApi } from '../../src/api';
import { useAuth } from '../../src/context/AuthContext';
import { colors, shared } from '../../src/styles';

export default function SalesHomeScreen() {
  const { user, refreshUser } = useAuth();
  const router = useRouter();
  const [locations, setLocations] = useState<any[]>([]);
  const [today, setToday] = useState<any[]>([]);
  const [pendingFollowUp, setPendingFollowUp] = useState<any[]>([]);

  const load = async () => {
    const [locRes, todayRes, followRes] = await Promise.all([
      salesApi.getLocations(),
      salesApi.getTodayAttendance(),
      salesApi.getPendingFollowUp(),
    ]);
    setLocations(locRes.data);
    setToday(todayRes.data);
    setPendingFollowUp(followRes.data);
  };

  useFocusEffect(useCallback(() => { load(); refreshUser(); }, []));

  useEffect(() => {
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  const submitFollowUp = async (record: any) => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return Alert.alert('Permission needed', 'Location required');

    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const { data } = await salesApi.submitFollowUp(record.id, loc.coords.latitude, loc.coords.longitude);
      Alert.alert(data.success ? 'Verified' : 'Failed', data.message);
      load();
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.error || err.message);
    }
  };

  return (
    <ScrollView style={shared.container} contentContainerStyle={shared.content} refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
      <Text style={shared.title}>Hello, {user?.name}</Text>
      <Text style={shared.subtitle}>Your assigned locations & attendance</Text>

      {!user?.hasFaceEnrolled && (
        <TouchableOpacity style={[shared.card, { borderColor: colors.warning }]} onPress={() => router.push('/(sales)/enroll-face')}>
          <Text style={{ color: colors.warning, fontWeight: '600' }}>⚠️ Enroll your face before checking in</Text>
        </TouchableOpacity>
      )}

      {pendingFollowUp.length > 0 && (
        <View style={[shared.card, { borderColor: colors.danger }]}>
          <Text style={{ color: colors.danger, fontWeight: '700', marginBottom: 8 }}>📍 Location Verification Required</Text>
          <Text style={shared.cardSub}>Please verify your location to confirm you are still on-site (anti mock-GPS check)</Text>
          {pendingFollowUp.map((r) => (
            <TouchableOpacity key={r.id} style={[shared.btn, { marginTop: 8 }]} onPress={() => submitFollowUp(r)}>
              <Text style={shared.btnText}>Verify at {r.location_name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <Text style={{ color: colors.text, fontWeight: '600', marginTop: 16, marginBottom: 8 }}>Assigned Locations</Text>
      {locations.map((loc) => (
        <View key={loc.id} style={shared.card}>
          <Text style={shared.cardTitle}>{loc.name}</Text>
          <Text style={shared.cardSub}>{loc.address}</Text>
          <Text style={shared.cardSub}>Radius: {loc.radius_meters}m</Text>
        </View>
      ))}

      <Text style={{ color: colors.text, fontWeight: '600', marginTop: 16, marginBottom: 8 }}>Today's Check-ins</Text>
      {today.length === 0 ? (
        <Text style={{ color: colors.muted }}>No check-ins today</Text>
      ) : (
        today.map((r) => (
          <View key={r.id} style={shared.card}>
            <Text style={shared.cardTitle}>{r.location_name}</Text>
            <Text style={shared.cardSub}>{new Date(r.checked_in_at).toLocaleTimeString()}</Text>
            <Text style={shared.cardSub}>Follow-up: {r.follow_up_status}</Text>
          </View>
        ))
      )}
    </ScrollView>
  );
}
