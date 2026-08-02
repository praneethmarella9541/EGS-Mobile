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
  Linking,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { format, subDays, subMonths } from 'date-fns';
import DateTimePicker from '@react-native-community/datetimepicker';
import { ScreenHeader } from '../../../components/ScreenHeader';
import { useAuth } from '../../../hooks/useAuth';
import { Colors } from '../../../constants/colors';
import { listAssignableUsers, toDateKey, type AssignableUser } from '../../../lib/assignments';
import { listAdminAssignments, getPhotoUrls, downloadPhotoToGallery } from '../../../lib/visits';
import type { AdminAssignmentRow, LocationVisit } from '../../../lib/types';

type DatePickerTarget = 'from' | 'to' | null;

/**
 * How much to trust a visit's place, in one line. Since the place is normally
 * derived from the user's GPS fix, distance_m is near-zero by construction and
 * says little — what matters is how the place was obtained, how good the fix
 * was, and how long the user sat on it before submitting.
 */
function visitProvenance(v: LocationVisit): string {
  const parts: string[] = [];

  if (v.place_source === 'nearby') parts.push('auto-picked');
  else if (v.place_source === 'reverse_geocode') parts.push('address at GPS');
  else if (v.place_source === 'manual_search') parts.push('⚠ hand-searched');
  else parts.push(`${v.distance_m}m from address`); // pre-GPS-flow visit

  if (v.label_edited) parts.push('name edited');
  if (v.gps_accuracy_m !== null) parts.push(`±${Math.round(v.gps_accuracy_m)}m`);

  if (v.fetched_at) {
    const gapMin = Math.round(
      (new Date(v.submitted_at).getTime() - new Date(v.fetched_at).getTime()) / 60000
    );
    if (gapMin >= 10) parts.push(`⚠ submitted ${gapMin}m after fetch`);
  }

  return parts.join(' · ');
}

function photoCount(row: AdminAssignmentRow): number {
  return row.visits.reduce((sum, v) => sum + v.photos.length, 0);
}

function formatDuration(minutes: number): string {
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * First and last visit logged under this area, and the span between them —
 * lets an admin see how long a user was active at a location without
 * expanding every individual visit. `row.visits` is pre-sorted ascending.
 */
function visitSpan(
  row: AdminAssignmentRow
): { first: string; last: string; minutes: number; durationLabel: string | null } | null {
  if (row.visits.length === 0) return null;
  const first = row.visits[0].submitted_at;
  const last = row.visits[row.visits.length - 1].submitted_at;
  const minutes = Math.round((new Date(last).getTime() - new Date(first).getTime()) / 60000);
  return { first, last, minutes, durationLabel: minutes <= 0 ? null : `${formatDuration(minutes)} span` };
}

/**
 * Total time-on-site across the filtered rows, for the "Total hours" stat.
 * Deliberately NOT a sum of each area's own visitSpan — that under-counts,
 * since a single-visit area contributes zero (no span within itself) even
 * though that timestamp is a real point in the person's day, and it ignores
 * the time between visiting different areas. Instead, group by (user, day)
 * across ALL their areas and take last − first over the combined set — a
 * user with one visit total that day has no span to compute (contributes 0,
 * correctly — a single instant has no duration), but one with several areas
 * spread across the day gets the real end-to-end span.
 */
function totalActiveMinutes(rows: AdminAssignmentRow[]): number {
  const byUserDay = new Map<string, number[]>();
  for (const r of rows) {
    if (r.visits.length === 0) continue;
    const key = `${r.user_id}|${r.assigned_date}`;
    const times = byUserDay.get(key) ?? [];
    for (const v of r.visits) times.push(new Date(v.submitted_at).getTime());
    byUserDay.set(key, times);
  }
  let total = 0;
  for (const times of byUserDay.values()) {
    if (times.length < 2) continue;
    total += Math.round((Math.max(...times) - Math.min(...times)) / 60000);
  }
  return total;
}

export default function AttendanceScreen() {
  const { isAdmin } = useAuth();
  const { width: screenWidth } = useWindowDimensions();

  const [fromDate, setFromDate] = useState(new Date());
  const [toDate, setToDate] = useState(new Date());
  const [activePreset, setActivePreset] = useState<'1d' | '1w' | '1m' | null>(null);
  const [activePicker, setActivePicker] = useState<DatePickerTarget>(null);

  const [users, setUsers] = useState<AssignableUser[]>([]);
  const [userId, setUserId] = useState<string>(''); // '' = all users
  const [userPickerOpen, setUserPickerOpen] = useState(false);

  const [rows, setRows] = useState<AdminAssignmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [gallery, setGallery] = useState<string[] | null>(null);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [downloading, setDownloading] = useState(false);

  const fromKey = toDateKey(fromDate);
  const toKey = toDateKey(toDate);

  const load = useCallback(async () => {
    try {
      setRows(await listAdminAssignments({ from: fromKey, to: toKey, userId: userId || undefined }));
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to load attendance');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fromKey, toKey, userId]);

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    load();
  }, [isAdmin, load]);

  useEffect(() => {
    if (isAdmin) listAssignableUsers().then(setUsers).catch(() => {});
  }, [isAdmin]);

  // Keep the range non-inverted without a separate validation error — picking
  // a "from" after the current "to" (or vice versa) just drags the other end.
  // A manual edit means the range no longer matches any preset, so clear the highlight.
  function onFromPicked(selected: Date) {
    setFromDate(selected);
    if (toDateKey(selected) > toKey) setToDate(selected);
    setActivePreset(null);
  }
  function onToPicked(selected: Date) {
    setToDate(selected);
    if (toDateKey(selected) < fromKey) setFromDate(selected);
    setActivePreset(null);
  }

  function applyPreset(preset: '1d' | '1w' | '1m') {
    const today = new Date();
    const start = preset === '1d' ? today : preset === '1w' ? subDays(today, 6) : subMonths(today, 1);
    setFromDate(start);
    setToDate(today);
    setActivePreset(preset);
  }

  function resetFilters() {
    const today = new Date();
    setFromDate(today);
    setToDate(today);
    setUserId('');
    setActivePreset(null);
  }

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
    try {
      const paths = visit.photos.map((p) => p.photo_path);
      const urls = await getPhotoUrls(paths);
      const usable = urls.filter((u): u is string => !!u);
      // Every path came back unsigned — don't open an empty lightbox and leave
      // the admin wondering whether the tap registered.
      if (usable.length === 0) {
        Alert.alert(
          'Photos unavailable',
          'Storage returned no link for this visit’s photos. They may have been deleted, or predate the move to Google Cloud Storage.'
        );
        return;
      }
      setGalleryIndex(0);
      setGallery(usable);
    } catch (e: any) {
      Alert.alert('Could not open photos', e?.message ?? 'Please try again.');
    }
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

  // Hooks must run unconditionally on every render — keep this useMemo above
  // the `!isAdmin` early return below (signing out flips isAdmin to false
  // while this screen may still be mounted, which would otherwise render
  // fewer hooks than the previous pass and crash).
  const todayKey = toDateKey(new Date());
  const stats = useMemo(() => {
    const totalAreas = rows.length;
    const visited = rows.filter((r) => r.visits.length > 0).length;
    const totalVisits = rows.reduce((sum, r) => sum + r.visits.length, 0);
    const totalPhotos = rows.reduce((sum, r) => sum + photoCount(r), 0);
    const totalMinutes = totalActiveMinutes(rows);
    return { totalAreas, visited, totalVisits, totalPhotos, totalMinutes };
  }, [rows]);

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

  function statusPill(row: AdminAssignmentRow, isPast: boolean) {
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
            {format(new Date(v.submitted_at), 'MMM d, h:mm a')} · {visitProvenance(v)}
          </Text>
          <TouchableOpacity
            onPress={() =>
              Linking.openURL(
                `https://www.google.com/maps/search/?api=1&query=${v.latitude},${v.longitude}`
              )
            }
          >
            <Text style={styles.mapLink}>View on map</Text>
          </TouchableOpacity>
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

  function renderRow(row: AdminAssignmentRow) {
    const isOpen = expanded.has(row.id);
    const isPast = row.assigned_date < todayKey;
    const heading = row.profile?.display_name || row.profile?.email || 'Unknown user';
    const dateLabel = format(new Date(`${row.assigned_date}T00:00:00`), 'EEE, MMM d');
    const span = visitSpan(row);
    return (
      <View key={row.id} style={styles.row}>
        <TouchableOpacity style={styles.rowHeader} activeOpacity={0.75} onPress={() => toggleExpand(row.id)}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{heading.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowName} numberOfLines={1}>
              {heading}
            </Text>
            <Text style={styles.rowSub} numberOfLines={1}>
              {row.area_label} · {dateLabel}
            </Text>
            {span ? (
              <Text style={styles.rowSpan} numberOfLines={1}>
                {span.first === span.last
                  ? `Logged ${format(new Date(span.first), 'h:mm a')}`
                  : `${format(new Date(span.first), 'h:mm a')} – ${format(new Date(span.last), 'h:mm a')}${
                      span.durationLabel ? ` · ${span.durationLabel}` : ''
                    }`}
              </Text>
            ) : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {statusPill(row, isPast)}
              {photoCount(row) > 0 && (
                <View style={styles.photoPill}>
                  <Ionicons name="image-outline" size={11} color={Colors.primary} />
                  <Text style={styles.photoPillText}>{photoCount(row)}</Text>
                </View>
              )}
            </View>
          </View>
          <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={18} color={Colors.textMuted} />
        </TouchableOpacity>
        {isOpen && row.visits.length > 0 ? (
          <View style={styles.visitsList}>{row.visits.map(renderVisit)}</View>
        ) : null}
      </View>
    );
  }

  const selectedUserLabel = userId
    ? users.find((u) => u.id === userId)?.display_name || users.find((u) => u.id === userId)?.email || '…'
    : 'All users';

  const heroStats = [
    {
      icon: 'checkmark-circle-outline' as const,
      value: `${stats.visited}/${stats.totalAreas}`,
      label: 'Areas visited',
    },
    { icon: 'location-outline' as const, value: stats.totalVisits, label: 'Visits logged' },
    { icon: 'close-circle-outline' as const, value: stats.totalAreas - stats.visited, label: 'Not visited' },
    { icon: 'image-outline' as const, value: stats.totalPhotos, label: 'Photos captured' },
    { icon: 'time-outline' as const, value: formatDuration(stats.totalMinutes), label: 'Total hours' },
  ];

  return (
    <View style={styles.container}>
      <ScreenHeader title="Attendance" />

      <View style={styles.dateRow}>
        <TouchableOpacity style={styles.dateChip} onPress={() => setActivePicker('from')} activeOpacity={0.8}>
          <Text style={styles.dateChipLabel}>From</Text>
          <Text style={styles.dateChipValue}>{format(fromDate, 'MMM d, yyyy')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.dateChip} onPress={() => setActivePicker('to')} activeOpacity={0.8}>
          <Text style={styles.dateChipLabel}>To</Text>
          <Text style={styles.dateChipValue}>{format(toDate, 'MMM d, yyyy')}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.presetRow}>
        {(['1d', '1w', '1m'] as const).map((preset) => {
          const active = activePreset === preset;
          return (
            <TouchableOpacity
              key={preset}
              style={[styles.presetBtn, active && styles.presetBtnActive]}
              onPress={() => applyPreset(preset)}
            >
              <Text style={[styles.presetBtnText, active && styles.presetBtnTextActive]}>
                {preset.toUpperCase()}
              </Text>
            </TouchableOpacity>
          );
        })}
        <TouchableOpacity style={styles.resetBtn} onPress={resetFilters}>
          <Ionicons name="refresh-outline" size={14} color={Colors.textSecondary} />
          <Text style={styles.resetBtnText}>Reset</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.selectorBar} onPress={() => setUserPickerOpen(true)} activeOpacity={0.8}>
        <Ionicons name="person-outline" size={18} color={Colors.primary} />
        <Text style={styles.selectorText}>{selectedUserLabel}</Text>
        <Ionicons name="chevron-down" size={18} color={Colors.textMuted} />
      </TouchableOpacity>

      {activePicker && (
        <DateTimePicker
          value={activePicker === 'from' ? fromDate : toDate}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          onChange={(e, selected) => {
            const target = activePicker;
            setActivePicker(null);
            // Android fires 'dismissed' (tap-away / Cancel) with the current date — ignore it.
            if (e.type !== 'set' || !selected) return;
            if (target === 'from') onFromPicked(selected);
            else onToPicked(selected);
          }}
        />
      )}

      {!loading ? (
        <View style={styles.heroGrid}>
          {heroStats.map((s) => (
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
                load();
              }}
              tintColor={Colors.primary}
            />
          }
        >
          {rows.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="calendar-clear-outline" size={28} color={Colors.textMuted} />
              <Text style={styles.emptyText}>
                {userId ? 'No assignments for this user in this range.' : 'No assignments in this range.'}
              </Text>
            </View>
          ) : (
            rows.map(renderRow)
          )}
        </ScrollView>
      )}

      {/* User picker */}
      <Modal
        visible={userPickerOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setUserPickerOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Filter by user</Text>
              <TouchableOpacity onPress={() => setUserPickerOpen(false)} hitSlop={8}>
                <Ionicons name="close" size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={[{ id: '', display_name: 'All users', email: '' } as AssignableUser, ...users]}
              keyExtractor={(u) => u.id || 'all'}
              contentContainerStyle={{ paddingBottom: 24 }}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.pickerRow}
                  onPress={() => {
                    setUserId(item.id);
                    setUserPickerOpen(false);
                  }}
                >
                  <Text style={styles.pickerRowText}>
                    {item.id ? item.display_name || item.email : 'All users'}
                  </Text>
                  {item.id === userId && <Ionicons name="checkmark" size={18} color={Colors.primary} />}
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
  dateRow: {
    flexDirection: 'row',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
  },
  dateChip: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  dateChipLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  dateChipValue: { fontSize: 14, fontWeight: '700', color: Colors.text, marginTop: 2 },
  presetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 8,
  },
  presetBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  presetBtnText: { fontSize: 12, fontWeight: '700', color: Colors.textSecondary },
  presetBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  presetBtnTextActive: { color: '#fff' },
  resetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 'auto',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  resetBtnText: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary },
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
  list: { padding: 16, paddingBottom: 40, gap: 10 },
  empty: { alignItems: 'center', gap: 8, paddingTop: 50 },
  emptyText: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', paddingHorizontal: 20 },
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
  rowSpan: { fontSize: 11, color: Colors.textMuted, marginTop: 2 },
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
  photoPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    alignSelf: 'flex-start',
    marginTop: 6,
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  photoPillText: { fontSize: 11, fontWeight: '700', color: Colors.primary },
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
  mapLink: { fontSize: 11, fontWeight: '600', color: Colors.primary, marginTop: 2 },
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
