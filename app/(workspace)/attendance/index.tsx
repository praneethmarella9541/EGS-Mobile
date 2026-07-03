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
  Modal,
  FlatList,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { ScreenHeader } from '../../../components/ScreenHeader';
import { useAuth } from '../../../hooks/useAuth';
import { Colors } from '../../../constants/colors';
import { listAssignableUsers, toDateKey, type AssignableUser } from '../../../lib/assignments';
import { listAttendanceForDate, listAttendanceForUser, getPhotoUrl } from '../../../lib/attendance';
import type { AdminAttendanceRow, AssignmentWithStatus } from '../../../lib/types';

type ViewMode = 'date' | 'user';

export default function AttendanceScreen() {
  const { isAdmin } = useAuth();
  const [mode, setMode] = useState<ViewMode>('date');

  // By-date state
  const [date, setDate] = useState(new Date());
  const [showPicker, setShowPicker] = useState(false);
  const [dateRows, setDateRows] = useState<AdminAttendanceRow[]>([]);

  // By-user state
  const [users, setUsers] = useState<AssignableUser[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<AssignableUser | null>(null);
  const [userRows, setUserRows] = useState<AssignmentWithStatus[]>([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  const dateKey = toDateKey(date);

  const loadByDate = useCallback(async () => {
    try {
      setDateRows(await listAttendanceForDate(dateKey));
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to load attendance');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [dateKey]);

  const loadByUser = useCallback(async () => {
    if (!selectedUser) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      setUserRows(await listAttendanceForUser(selectedUser.id));
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to load attendance');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedUser]);

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    if (mode === 'date') loadByDate();
    else loadByUser();
  }, [isAdmin, mode, loadByDate, loadByUser]);

  useEffect(() => {
    if (isAdmin) listAssignableUsers().then(setUsers).catch(() => {});
  }, [isAdmin]);

  async function viewPhoto(photoPath: string | null | undefined) {
    if (!photoPath) return;
    const url = await getPhotoUrl(photoPath);
    setPhotoUrl(url);
  }

  if (!isAdmin) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Attendance" />
        <View style={styles.locked}>
          <Ionicons name="lock-closed-outline" size={32} color={Colors.textMuted} />
          <Text style={styles.lockedTitle}>Admin access required</Text>
        </View>
      </View>
    );
  }

  function statusPill(row: AdminAttendanceRow | AssignmentWithStatus, isPast: boolean) {
    if (row.attendance) {
      const verified = row.attendance.verified;
      return (
        <View style={[styles.pill, verified ? styles.pillDone : styles.pillWarn]}>
          <Ionicons
            name={verified ? 'checkmark-circle' : 'alert-circle'}
            size={13}
            color={verified ? Colors.success : Colors.warning}
          />
          <Text style={[styles.pillText, { color: verified ? Colors.success : Colors.warning }]}>
            {verified ? 'Verified' : 'Unverified'} · {row.attendance.distance_m}m
            {row.attendance.face_similarity != null ? ` · ${(row.attendance.face_similarity * 100).toFixed(0)}%` : ''}
          </Text>
        </View>
      );
    }
    return (
      <View style={[styles.pill, isPast ? styles.pillExpired : styles.pillPending]}>
        <Text style={[styles.pillText, { color: isPast ? Colors.textMuted : Colors.warning }]}>
          {isPast ? 'No-show' : 'Pending'}
        </Text>
      </View>
    );
  }

  const prettyDate = date.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const todayKey = toDateKey(new Date());

  return (
    <View style={styles.container}>
      <ScreenHeader title="Attendance" />

      <View style={styles.toggleRow}>
        <TouchableOpacity
          style={[styles.toggleBtn, mode === 'date' && styles.toggleBtnActive]}
          onPress={() => setMode('date')}
        >
          <Text style={[styles.toggleText, mode === 'date' && styles.toggleTextActive]}>By Date</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggleBtn, mode === 'user' && styles.toggleBtnActive]}
          onPress={() => setMode('user')}
        >
          <Text style={[styles.toggleText, mode === 'user' && styles.toggleTextActive]}>By User</Text>
        </TouchableOpacity>
      </View>

      {mode === 'date' ? (
        <TouchableOpacity style={styles.selectorBar} onPress={() => setShowPicker(true)} activeOpacity={0.8}>
          <Ionicons name="calendar-outline" size={18} color={Colors.primary} />
          <Text style={styles.selectorText}>{prettyDate}</Text>
          <Ionicons name="chevron-down" size={18} color={Colors.textMuted} />
        </TouchableOpacity>
      ) : (
        <TouchableOpacity style={styles.selectorBar} onPress={() => setPickerOpen(true)} activeOpacity={0.8}>
          <Ionicons name="person-outline" size={18} color={Colors.primary} />
          <Text style={styles.selectorText}>
            {selectedUser ? selectedUser.display_name || selectedUser.email : 'Choose a user…'}
          </Text>
          <Ionicons name="chevron-down" size={18} color={Colors.textMuted} />
        </TouchableOpacity>
      )}

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
                mode === 'date' ? loadByDate() : loadByUser();
              }}
              tintColor={Colors.primary}
            />
          }
        >
          {mode === 'date' ? (
            dateRows.length === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="calendar-clear-outline" size={28} color={Colors.textMuted} />
                <Text style={styles.emptyText}>No assignments for this date.</Text>
              </View>
            ) : (
              dateRows.map((row) => (
                <TouchableOpacity
                  key={row.id}
                  style={styles.row}
                  activeOpacity={0.75}
                  onPress={() => viewPhoto(row.attendance?.photo_path)}
                  disabled={!row.attendance}
                >
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>
                      {(row.profile?.display_name || row.profile?.email || '?').charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowName} numberOfLines={1}>
                      {row.profile?.display_name || row.profile?.email || 'Unknown user'}
                    </Text>
                    <Text style={styles.rowSub} numberOfLines={1}>
                      {row.location_label}
                    </Text>
                    {statusPill(row, dateKey < todayKey)}
                  </View>
                </TouchableOpacity>
              ))
            )
          ) : !selectedUser ? (
            <View style={styles.empty}>
              <Ionicons name="person-outline" size={28} color={Colors.textMuted} />
              <Text style={styles.emptyText}>Choose a user to see their history.</Text>
            </View>
          ) : userRows.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="calendar-clear-outline" size={28} color={Colors.textMuted} />
              <Text style={styles.emptyText}>No assignments for this user yet.</Text>
            </View>
          ) : (
            userRows.map((row) => (
              <TouchableOpacity
                key={row.id}
                style={styles.row}
                activeOpacity={0.75}
                onPress={() => viewPhoto(row.attendance?.photo_path)}
                disabled={!row.attendance}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName} numberOfLines={1}>
                    {row.assigned_date}
                  </Text>
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {row.location_label}
                  </Text>
                  {statusPill(row, row.assigned_date < todayKey)}
                </View>
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      )}

      {/* User picker */}
      <Modal visible={pickerOpen} animationType="slide" transparent onRequestClose={() => setPickerOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Choose a user</Text>
              <TouchableOpacity onPress={() => setPickerOpen(false)} hitSlop={8}>
                <Ionicons name="close" size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={users}
              keyExtractor={(u) => u.id}
              contentContainerStyle={{ paddingBottom: 24 }}
              ListEmptyComponent={<Text style={styles.emptyText}>No users yet.</Text>}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.pickerRow}
                  onPress={() => {
                    setSelectedUser(item);
                    setPickerOpen(false);
                    setLoading(true);
                  }}
                >
                  <Text style={styles.pickerRowText}>{item.display_name || item.email}</Text>
                  <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>

      {/* Photo viewer */}
      <Modal visible={!!photoUrl} animationType="fade" transparent onRequestClose={() => setPhotoUrl(null)}>
        <TouchableOpacity style={styles.photoBackdrop} activeOpacity={1} onPress={() => setPhotoUrl(null)}>
          {photoUrl ? <Image source={{ uri: photoUrl }} style={styles.photoFull} resizeMode="contain" /> : null}
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  locked: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  lockedTitle: { fontSize: 17, fontWeight: '700', color: Colors.text },
  toggleRow: {
    flexDirection: 'row',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
  },
  toggleBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  toggleBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  toggleText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  toggleTextActive: { color: '#fff' },
  selectorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  selectorText: { flex: 1, fontSize: 15, fontWeight: '600', color: Colors.text },
  list: { padding: 16, gap: 10 },
  empty: { alignItems: 'center', gap: 8, paddingTop: 50 },
  emptyText: { fontSize: 14, color: Colors.textSecondary },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: Colors.primary, fontWeight: '700', fontSize: 15 },
  rowName: { fontSize: 15, fontWeight: '600', color: Colors.text },
  rowSub: { fontSize: 13, color: Colors.textSecondary, marginTop: 1 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  pillDone: { backgroundColor: '#ECFDF5' },
  pillWarn: { backgroundColor: '#FEF3C7' },
  pillPending: { backgroundColor: '#FEF3C7' },
  pillExpired: { backgroundColor: Colors.borderLight },
  pillText: { fontSize: 11, fontWeight: '700' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: Colors.background,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 10,
    height: '70%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: Colors.text },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
    backgroundColor: Colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  pickerRowText: { fontSize: 15, color: Colors.text },
  photoBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', alignItems: 'center', justifyContent: 'center' },
  photoFull: { width: '100%', height: '80%' },
});
