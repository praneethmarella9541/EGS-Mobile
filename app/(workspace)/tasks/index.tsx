import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Platform,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker';
import { ScreenHeader } from '../../../components/ScreenHeader';
import { Colors } from '../../../constants/colors';
import { listMyAssignments, toDateKey } from '../../../lib/assignments';
import { submitAttendance } from '../../../lib/attendance';
import { GEO_RADIUS_M, type AssignmentWithStatus } from '../../../lib/types';

export default function TasksScreen() {
  const router = useRouter();
  const [date, setDate] = useState(new Date());
  const [showPicker, setShowPicker] = useState(false);
  const [tasks, setTasks] = useState<AssignmentWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const dateKey = toDateKey(date);

  const load = useCallback(async () => {
    try {
      setTasks(await listMyAssignments(dateKey));
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to load tasks');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [dateKey]);

  useEffect(() => {
    load();
  }, [load]);

  async function checkIn(task: AssignmentWithStatus) {
    // 1. Camera permission + capture
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Camera needed', 'Allow camera access to take your attendance photo.');
      return;
    }
    const shot = await ImagePicker.launchCameraAsync({ quality: 0.5, cameraType: ImagePicker.CameraType.front });
    if (shot.canceled || !shot.assets?.[0]?.uri) return;

    // 2. Geo-verify + upload + record
    setBusyId(task.id);
    try {
      await submitAttendance(task, shot.assets[0].uri);
      await load();
      Alert.alert('Checked in', 'Attendance recorded. The form is now unlocked.');
    } catch (e: any) {
      Alert.alert('Check-in failed', e?.message ?? 'Please try again.');
    } finally {
      setBusyId(null);
    }
  }

  function openForm(task: AssignmentWithStatus) {
    router.push({
      pathname: '/(workspace)/form-view',
      params: { url: task.form_url, title: task.location_label },
    } as any);
  }

  const prettyDate = date.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const isToday = toDateKey(new Date()) === dateKey;

  return (
    <View style={styles.container}>
      <ScreenHeader title="My Tasks" />

      <TouchableOpacity style={styles.dateBar} onPress={() => setShowPicker(true)} activeOpacity={0.8}>
        <Ionicons name="calendar-outline" size={18} color={Colors.primary} />
        <Text style={styles.dateText}>
          {prettyDate}
          {isToday ? '  · Today' : ''}
        </Text>
        <Ionicons name="chevron-down" size={18} color={Colors.textMuted} />
      </TouchableOpacity>
      {showPicker && (
        <DateTimePicker
          value={date}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          onChange={(_e, selected) => {
            setShowPicker(Platform.OS === 'ios');
            if (selected) {
              setLoading(true);
              setDate(selected);
            }
          }}
        />
      )}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
              tintColor={Colors.primary}
            />
          }
        >
          {tasks.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="checkmark-done-outline" size={30} color={Colors.textMuted} />
              <Text style={styles.emptyText}>No tasks assigned for this date.</Text>
            </View>
          ) : (
            tasks.map((task, i) => {
              const done = !!task.attendance;
              const busy = busyId === task.id;
              return (
                <View key={task.id} style={styles.card}>
                  <View style={styles.cardHeader}>
                    <Text style={styles.cardNum}>{i + 1}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.location}>{task.location_label}</Text>
                      {done && (
                        <Text style={styles.verified}>
                          ✓ Checked in · {task.attendance!.distance_m} m away
                        </Text>
                      )}
                    </View>
                    {done ? (
                      <View style={styles.badgeDone}>
                        <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
                        <Text style={styles.badgeDoneText}>Done</Text>
                      </View>
                    ) : (
                      <View style={styles.badgePending}>
                        <Text style={styles.badgePendingText}>Pending</Text>
                      </View>
                    )}
                  </View>

                  {!done ? (
                    <>
                      <TouchableOpacity
                        style={[styles.actionBtn, busy && { opacity: 0.6 }]}
                        onPress={() => checkIn(task)}
                        disabled={busy}
                      >
                        {busy ? (
                          <ActivityIndicator color="#fff" />
                        ) : (
                          <>
                            <Ionicons name="camera-outline" size={18} color="#fff" />
                            <Text style={styles.actionBtnText}>Photo check-in</Text>
                          </>
                        )}
                      </TouchableOpacity>
                      <View style={styles.lockedForm}>
                        <Ionicons name="lock-closed" size={14} color={Colors.textMuted} />
                        <Text style={styles.lockedFormText}>
                          Form unlocks after check-in (within {GEO_RADIUS_M} m)
                        </Text>
                      </View>
                    </>
                  ) : (
                    <TouchableOpacity style={styles.formBtn} onPress={() => openForm(task)}>
                      <Ionicons name="document-text-outline" size={18} color={Colors.primary} />
                      <Text style={styles.formBtnText}>Open & fill form</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  dateBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  dateText: { flex: 1, fontSize: 15, fontWeight: '600', color: Colors.text },
  list: { padding: 16, gap: 14 },
  empty: { alignItems: 'center', gap: 8, paddingTop: 50 },
  emptyText: { fontSize: 14, color: Colors.textSecondary },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    gap: 12,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  cardNum: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: Colors.primaryLight,
    color: Colors.primary,
    fontWeight: '700',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 26,
  },
  location: { fontSize: 15, fontWeight: '600', color: Colors.text, lineHeight: 20 },
  verified: { fontSize: 12, color: Colors.success, marginTop: 4 },
  badgeDone: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  badgeDoneText: { fontSize: 12, fontWeight: '600', color: Colors.success },
  badgePending: {
    backgroundColor: '#FEF3C7',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgePendingText: { fontSize: 11, fontWeight: '700', color: Colors.warning },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 11,
    paddingVertical: 13,
  },
  actionBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  lockedForm: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center' },
  lockedFormText: { fontSize: 12, color: Colors.textMuted },
  formBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    borderRadius: 11,
    paddingVertical: 12,
  },
  formBtnText: { color: Colors.primary, fontSize: 15, fontWeight: '700' },
});
