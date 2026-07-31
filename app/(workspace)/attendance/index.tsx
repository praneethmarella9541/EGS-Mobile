import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import DateTimePicker from '@react-native-community/datetimepicker';
import { ScreenHeader } from '../../../components/ScreenHeader';
import { useAuth } from '../../../hooks/useAuth';
import { Colors } from '../../../constants/colors';
import { listAssignableUsers, toDateKey, type AssignableUser } from '../../../lib/assignments';
import {
  listAdminAssignmentsForDate,
  listAdminAssignmentsForUser,
  getPhotoUrl,
  downloadPhotoToGallery,
} from '../../../lib/visits';
import type { AdminAssignmentRow, AssignmentWithVisits, LocationVisit } from '../../../lib/types';

type ViewMode = 'date' | 'user';

export default function AttendanceScreen() {
  const { isAdmin } = useAuth();
  const { width: screenWidth } = useWindowDimensions();
  const [mode, setMode] = useState<ViewMode>('date');

  // By-date state
  const [date, setDate] = useState(new Date());
  const [showPicker, setShowPicker] = useState(false);
  const [dateRows, setDateRows] = useState<AdminAssignmentRow[]>([]);

  // By-user state
  const [users, setUsers] = useState<AssignableUser[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<AssignableUser | null>(null);
  const [userRows, setUserRows] = useState<AssignmentWithVisits[]>([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [gallery, setGallery] = useState<string[] | null>(null);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [downloading, setDownloading] = useState(false);

  const dateKey = toDateKey(date);

  const loadByDate = useCallback(async () => {
    try {
      setDateRows(await listAdminAssignmentsForDate(dateKey));
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
      setUserRows(await listAdminAssignmentsForUser(selectedUser.id));
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

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  }

  async function viewPhotos(visit: LocationVisit) {
    if (visit.photos.length === 0) return;
    const urls = await Promise.all(visit.photos.map((p) => getPhotoUrl(p.photo_path)));
    setGalleryIndex(0);
    setGallery(urls.filter((u): u is string => !!u));
  }

  async function downloadCurrentPhoto() {
    if (!gallery?.[galleryIndex]) return;
    setDownloading(true);
    try {
      await downloadPhotoToGallery(gallery[galleryIndex], `visit-photo-${Date.now()}.jpg`);
      Alert.alert('Saved', 'Photo saved to your gallery.');
    } catch (e: any) {
      Alert.alert('Could not save photo', e?.message ?? 'Please try again.');
    } finally {
      setDownloading(false);
    }
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

  function statusPill(row: AdminAssignmentRow | AssignmentWithVisits, isPast: boolean) {
    const count = row.visits.length;
    if (count > 0) {
      return (
        <View style={[styles.pill, styles.pillDone]}>
          <Ionicons name="checkmark-circle" size={13} color={Colors.success} />
          <Text style={[styles.pillText, { color: Colors.success }]}>
            {count} visit{count === 1 ? '' : 's'}
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

  function renderVisit(v: LocationVisit) {
    return (
      <View key={v.id} style={styles.visitRow}>
        <Ionicons name="location" size={14} color={Colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={styles.visitPlace} numberOfLines={1}>
            {v.place_label}
          </Text>
          {v.notes ? (
            <Text style={styles.visitNotes} numberOfLines={2}>
              {v.notes}
            </Text>
          ) : null}
          <Text style={styles.visitTime}>
            {format(new Date(v.submitted_at), 'MMM d, h:mm a')} · {v.distance_m}m from address
          </Text>
        </View>
        {v.photos.length > 0 && (
          <TouchableOpacity style={styles.photoBtn} onPress={() => viewPhotos(v)}>
            <Ionicons name="image-outline" size={14} color={Colors.primary} />
            <Text style={styles.photoBtnText}>{v.photos.length}</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  function renderRow(row: AdminAssignmentRow | AssignmentWithVisits, isPast: boolean, label?: string) {
    const isOpen = expanded.has(row.id);
    return (
      <View key={row.id} style={styles.row}>
        <TouchableOpacity style={styles.rowHeader} activeOpacity={0.75} onPress={() => toggleExpand(row.id)}>
          {'profile' in row && row.profile ? (
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {(row.profile.display_name || row.profile.email || '?').charAt(0).toUpperCase()}
              </Text>
            </View>
          ) : null}
          <View style={{ flex: 1 }}>
            <Text style={styles.rowName} numberOfLines={1}>
              {label ?? ('profile' in row ? row.profile?.display_name || row.profile?.email : row.assigned_date)}
            </Text>
            <Text style={styles.rowSub} numberOfLines={1}>
              {row.area_label}
            </Text>
            {statusPill(row, isPast)}
          </View>
          <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={18} color={Colors.textMuted} />
        </TouchableOpacity>
        {isOpen && row.visits.length > 0 ? (
          <View style={styles.visitsList}>{row.visits.map(renderVisit)}</View>
        ) : null}
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
  const photoCount = (row: AdminAssignmentRow | AssignmentWithVisits) =>
    row.visits.reduce((sum, v) => sum + v.photos.length, 0);

  const dateStats = useMemo(() => {
    const totalAreas = dateRows.length;
    const visited = dateRows.filter((r) => r.visits.length > 0).length;
    const totalVisits = dateRows.reduce((sum, r) => sum + r.visits.length, 0);
    const totalPhotos = dateRows.reduce((sum, r) => sum + photoCount(r), 0);
    const isPast = dateKey < todayKey;
    return { totalAreas, visited, totalVisits, totalPhotos, isPast };
  }, [dateRows, dateKey, todayKey]);

  const userStats = useMemo(() => {
    const totalDays = userRows.length;
    const daysVisited = userRows.filter((r) => r.visits.length > 0).length;
    const totalVisits = userRows.reduce((sum, r) => sum + r.visits.length, 0);
    const totalPhotos = userRows.reduce((sum, r) => sum + photoCount(r), 0);
    return { totalDays, daysVisited, totalVisits, totalPhotos };
  }, [userRows]);

  function heroStats() {
    if (mode === 'date') {
      return [
        { icon: 'map-outline' as const, value: dateStats.totalAreas, label: 'Areas assigned' },
        {
          icon: 'checkmark-circle-outline' as const,
          value: dateStats.visited,
          label: `Visited of ${dateStats.totalAreas}`,
        },
        { icon: 'location-outline' as const, value: dateStats.totalVisits, label: 'Visits logged' },
        {
          icon: dateStats.isPast ? ('close-circle-outline' as const) : ('time-outline' as const),
          value: dateStats.totalAreas - dateStats.visited,
          label: dateStats.isPast ? 'No-shows' : 'Pending',
        },
        { icon: 'image-outline' as const, value: dateStats.totalPhotos, label: 'Photos captured' },
      ];
    }
    return [
      { icon: 'calendar-outline' as const, value: userStats.totalDays, label: 'Days assigned' },
      {
        icon: 'checkmark-circle-outline' as const,
        value: userStats.daysVisited,
        label: `Days visited of ${userStats.totalDays}`,
      },
      { icon: 'location-outline' as const, value: userStats.totalVisits, label: 'Visits logged' },
      { icon: 'image-outline' as const, value: userStats.totalPhotos, label: 'Photos captured' },
    ];
  }

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
        <TouchableOpacity style={styles.selectorBar} onPress={() => setShowPicker((v) => !v)} activeOpacity={0.8}>
          <Ionicons name="calendar-outline" size={18} color={Colors.primary} />
          <Text style={styles.selectorText}>{prettyDate}</Text>
          <Ionicons name={showPicker ? 'chevron-up' : 'chevron-down'} size={18} color={Colors.textMuted} />
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
            setShowPicker(false);
            if (selected) {
              setLoading(true);
              setDate(selected);
            }
          }}
        />
      )}

      {!loading && (mode === 'date' || selectedUser) ? (
        <View style={styles.heroGrid}>
          {heroStats().map((s) => (
            <View key={s.label} style={styles.heroCard}>
              <Ionicons name={s.icon} size={18} color={Colors.primary} />
              <Text style={styles.heroValue}>{s.value}</Text>
              <Text style={styles.heroLabel} numberOfLines={1}>
                {s.label}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

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
              dateRows.map((row) =>
                renderRow(row, dateKey < todayKey, row.profile?.display_name || row.profile?.email || 'Unknown user')
              )
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
            userRows.map((row) => renderRow(row, row.assigned_date < todayKey, row.assigned_date))
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

      {/* Photo gallery */}
      <Modal visible={!!gallery} animationType="fade" transparent onRequestClose={() => setGallery(null)}>
        <View style={styles.photoBackdrop}>
          <View style={styles.galleryTopBar}>
            <TouchableOpacity
              style={styles.galleryActionBtn}
              onPress={downloadCurrentPhoto}
              disabled={downloading}
              hitSlop={10}
            >
              {downloading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="download-outline" size={24} color="#fff" />
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.galleryActionBtn} onPress={() => setGallery(null)} hitSlop={10}>
              <Ionicons name="close" size={28} color="#fff" />
            </TouchableOpacity>
          </View>
          <FlatList
            data={gallery ?? []}
            keyExtractor={(u) => u}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) => {
              const idx = Math.round(e.nativeEvent.contentOffset.x / screenWidth);
              setGalleryIndex(idx);
            }}
            renderItem={({ item }) => (
              <View style={[styles.galleryPage, { width: screenWidth }]}>
                <Image source={{ uri: item }} style={[styles.photoFull, { width: screenWidth }]} resizeMode="contain" />
              </View>
            )}
          />
          {(gallery?.length ?? 0) > 1 ? (
            <Text style={styles.galleryCounter}>
              {galleryIndex + 1} / {gallery?.length}
            </Text>
          ) : null}
        </View>
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
  heroGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginHorizontal: 16,
    marginTop: 12,
  },
  heroCard: {
    flexBasis: '31%',
    flexGrow: 1,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: 'flex-start',
    gap: 4,
  },
  heroValue: { fontSize: 20, fontWeight: '800', color: Colors.text },
  heroLabel: { fontSize: 11, color: Colors.textSecondary },
  list: { padding: 16, gap: 10 },
  empty: { alignItems: 'center', gap: 8, paddingTop: 50 },
  emptyText: { fontSize: 14, color: Colors.textSecondary },
  row: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
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
  pillPending: { backgroundColor: '#FEF3C7' },
  pillExpired: { backgroundColor: Colors.borderLight },
  pillText: { fontSize: 11, fontWeight: '700' },
  visitsList: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
    padding: 14,
    gap: 10,
  },
  visitRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  visitPlace: { fontSize: 13, fontWeight: '600', color: Colors.text },
  visitNotes: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  visitTime: { fontSize: 11, color: Colors.textMuted, marginTop: 2 },
  photoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.background,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  photoBtnText: { fontSize: 12, fontWeight: '600', color: Colors.primary },
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
  photoBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)' },
  galleryTopBar: {
    position: 'absolute',
    top: 50,
    right: 20,
    left: 20,
    zIndex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  galleryActionBtn: { padding: 4 },
  galleryPage: { alignItems: 'center', justifyContent: 'center' },
  photoFull: { height: '80%' },
  galleryCounter: {
    position: 'absolute',
    bottom: 40,
    alignSelf: 'center',
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
});
