import { useCallback, useState } from 'react';
import { View, Text, ScrollView, RefreshControl } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { adminApi } from '../../src/api';
import { colors, shared } from '../../src/styles';

function formatCoord(value: number | null | undefined) {
  if (value == null) return '—';
  return Number(value).toFixed(6);
}

export default function AttendanceScreen() {
  const [records, setRecords] = useState<any[]>([]);

  const load = async () => {
    const { data } = await adminApi.getAttendance();
    setRecords(data);
  };

  useFocusEffect(useCallback(() => { load(); }, []));

  const statusColor = (status: string) => {
    if (status === 'completed') return colors.success;
    if (status === 'failed') return colors.danger;
    if (status === 'pending') return colors.warning;
    return colors.muted;
  };

  return (
    <ScrollView style={shared.container} contentContainerStyle={shared.content} refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
      <Text style={shared.title}>Attendance Log</Text>
      <Text style={shared.subtitle}>Face + GPS verified check-ins</Text>

      {records.length === 0 && <Text style={{ color: colors.muted }}>No attendance records yet</Text>}

      {records.map((r) => (
        <View key={r.id} style={shared.card}>
          <Text style={shared.cardTitle}>{r.user_name}</Text>
          <Text style={shared.cardSub}>📍 {r.location_name}</Text>
          <Text style={shared.cardSub}>🕐 {new Date(r.checked_in_at).toLocaleString()}</Text>

          <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border }}>
            <Text style={{ color: colors.text, fontWeight: '600', marginBottom: 6 }}>Location GPS</Text>
            <Text style={shared.cardSub}>
              Assigned: {formatCoord(r.assigned_latitude)}, {formatCoord(r.assigned_longitude)}
            </Text>
            <Text style={shared.cardSub}>
              Check-in: {formatCoord(r.check_in_lat)}, {formatCoord(r.check_in_lng)}
            </Text>
            <Text style={[shared.cardSub, { color: r.distance_meters <= (r.radius_meters || 100) ? colors.success : colors.danger }]}>
              Distance: {Math.round(r.distance_meters ?? 0)}m (allowed: {r.radius_meters || 100}m)
            </Text>
          </View>

          {r.follow_up_lat != null && (
            <View style={{ marginTop: 8 }}>
              <Text style={shared.cardSub}>
                Follow-up GPS: {formatCoord(r.follow_up_lat)}, {formatCoord(r.follow_up_lng)}
              </Text>
              {r.follow_up_distance_meters != null && (
                <Text style={shared.cardSub}>Follow-up distance: {Math.round(r.follow_up_distance_meters)}m</Text>
              )}
            </View>
          )}

          <Text style={[shared.cardSub, { marginTop: 8 }]}>
            Face: {r.face_verified ? '✅' : '❌'} ({((r.face_similarity || 0) * 100).toFixed(0)}%)
          </Text>
          <Text style={[shared.cardSub, { color: statusColor(r.follow_up_status) }]}>
            Follow-up: {r.follow_up_status}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}
