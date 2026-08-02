import React, { useCallback, useState } from 'react';
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
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import DateTimePicker from '@react-native-community/datetimepicker';
import { ScreenHeader } from '../../../components/ScreenHeader';
import { Colors } from '../../../constants/colors';
import { listMyAssignments, toDateKey } from '../../../lib/assignments';
import { resolveAssignmentForm } from '../../../lib/settings';
import { verifyStillNearVisit } from '../../../lib/visits';
import type { AssignmentWithVisits, LocationVisit } from '../../../lib/types';

export default function TasksScreen() {
  const router = useRouter();
  const [date, setDate] = useState(new Date());
  const [showPicker, setShowPicker] = useState(false);
  const [areas, setAreas] = useState<AssignmentWithVisits[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyVisitId, setBusyVisitId] = useState<string | null>(null);

  const dateKey = toDateKey(date);

  const load = useCallback(async () => {
    try {
      setAreas(await listMyAssignments(dateKey));
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to load tasks');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [dateKey]);

  // Fires on mount, whenever `load` changes (i.e. the date changed), AND on
  // returning from adding/editing a visit — covers date changes and stale
  // data in one place. A separate plain useEffect(load) here would double up
  // with this on every date change (useFocusEffect also re-fires when its
  // callback ref changes while already focused, not just on nav focus).
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  function addVisit(area: AssignmentWithVisits) {
    router.push({
      pathname: '/(workspace)/visit-new',
      params: {
        assignmentId: area.id,
        areaLabel: area.area_label,
        assignedDate: area.assigned_date,
        formId: area.form_id ?? '',
        formUrl: area.form_url ?? '',
      },
    } as any);
  }

  function editVisit(visit: LocationVisit) {
    router.push({
      pathname: '/(workspace)/visit-edit',
      params: { visitId: visit.id },
    } as any);
  }

  /** Re-verifies GPS against where the visit was logged before reopening the form. */
  async function reopenForm(visit: LocationVisit, area: AssignmentWithVisits) {
    setBusyVisitId(visit.id);
    try {
      await verifyStillNearVisit(visit);
      const field = await resolveAssignmentForm(area);
      if (!field) {
        Alert.alert('No form set', 'Ask your admin to set a field form in the Forms tab.');
        return;
      }
      router.push({
        pathname: '/(workspace)/form-view',
        params: { url: field.url, title: visit.place_label },
      } as any);
    } catch (e: any) {
      Alert.alert('Could not open form', e?.message ?? 'Please try again.');
    } finally {
      setBusyVisitId(null);
    }
  }

  const prettyDate = date.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const todayKey = toDateKey(new Date());
  const isToday = todayKey === dateKey;

  return (
    <View style={styles.container}>
      <ScreenHeader title="My Tasks" />

      <TouchableOpacity style={styles.dateBar} onPress={() => setShowPicker((v) => !v)} activeOpacity={0.8}>
        <Ionicons name="calendar-outline" size={18} color={Colors.primary} />
        <Text style={styles.dateText}>
          {prettyDate}
          {isToday ? '  · Today' : ''}
        </Text>
        <Ionicons name={showPicker ? 'chevron-up' : 'chevron-down'} size={18} color={Colors.textMuted} />
      </TouchableOpacity>
      {showPicker && (
        <DateTimePicker
          value={date}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          onChange={(e, selected) => {
            setShowPicker(false);
            // Android fires 'dismissed' (tap-away / Cancel) with the current date —
            // ignore it, and ignore re-picking the same day, so we never flip into
            // a loading state that has nothing to reload (was: infinite spinner).
            if (e.type !== 'set' || !selected) return;
            if (toDateKey(selected) === dateKey) return;
            setLoading(true);
            setDate(selected);
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
          {areas.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="checkmark-done-outline" size={30} color={Colors.textMuted} />
              <Text style={styles.emptyText}>No areas assigned for this date.</Text>
            </View>
          ) : (
            areas.map((area, i) => {
              // Only "today" is actionable. Past days are expired; future days
              // are locked but simply not reached yet — not "expired".
              const isFuture = area.assigned_date > todayKey;
              const isPast = area.assigned_date < todayKey;
              const locked = isFuture || isPast;
              return (
                <View key={area.id} style={styles.card}>
                  <View style={styles.cardHeader}>
                    <Text style={styles.cardNum}>{i + 1}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.location}>{area.area_label}</Text>
                      <Text style={styles.visitCount}>
                        {area.visits.length === 0
                          ? 'No locations logged yet'
                          : `${area.visits.length} location${area.visits.length === 1 ? '' : 's'} logged`}
                      </Text>
                    </View>
                  </View>

                  {area.visits.map((v) => {
                    const busy = busyVisitId === v.id;
                    return (
                      <View key={v.id} style={styles.visitBlock}>
                        <View style={styles.visitRow}>
                          <Ionicons name="location" size={14} color={Colors.primary} />
                          <View style={{ flex: 1 }}>
                            <Text style={styles.visitPlace} numberOfLines={1}>
                              {v.place_label}
                            </Text>
                            {v.notes ? (
                              <Text style={styles.visitNotes} numberOfLines={1}>
                                {v.notes}
                              </Text>
                            ) : null}
                          </View>
                          {v.photos.length > 0 && (
                            <View style={styles.photoBadge}>
                              <Ionicons name="image-outline" size={12} color={Colors.textSecondary} />
                              <Text style={styles.photoBadgeText}>{v.photos.length}</Text>
                            </View>
                          )}
                          <Text style={styles.visitTime}>{format(new Date(v.submitted_at), 'h:mm a')}</Text>
                        </View>
                        <View style={styles.visitActions}>
                          <TouchableOpacity style={styles.visitActionBtn} onPress={() => editVisit(v)}>
                            <Ionicons name="pencil-outline" size={14} color={Colors.primary} />
                            <Text style={styles.visitActionText}>Edit</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.visitActionBtn}
                            onPress={() => reopenForm(v, area)}
                            disabled={busy}
                          >
                            {busy ? (
                              <ActivityIndicator size="small" color={Colors.primary} />
                            ) : (
                              <>
                                <Ionicons name="document-text-outline" size={14} color={Colors.primary} />
                                <Text style={styles.visitActionText}>Open form</Text>
                              </>
                            )}
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })}

                  {locked ? (
                    <View style={styles.lockedForm}>
                      <Ionicons
                        name={isFuture ? 'lock-closed-outline' : 'time-outline'}
                        size={14}
                        color={Colors.textMuted}
                      />
                      <Text style={styles.lockedFormText}>
                        {isFuture
                          ? `Upcoming — The area is assigned for ${area.assigned_date}`
                          : `Expired — The area was assigned on ${area.assigned_date}`}
                      </Text>
                    </View>
                  ) : (
                    <TouchableOpacity style={styles.actionBtn} onPress={() => addVisit(area)}>
                      <Ionicons name="add-circle-outline" size={18} color="#fff" />
                      <Text style={styles.actionBtnText}>Add location visit</Text>
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
  visitCount: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  visitBlock: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
    paddingTop: 8,
    gap: 6,
  },
  visitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  visitPlace: { fontSize: 13, fontWeight: '500', color: Colors.text },
  visitNotes: { fontSize: 12, color: Colors.textMuted, marginTop: 1 },
  visitTime: { fontSize: 11, color: Colors.textMuted },
  visitActions: { flexDirection: 'row', gap: 8, paddingLeft: 22 },
  visitActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  visitActionText: { fontSize: 12, fontWeight: '600', color: Colors.primary },
  photoBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: Colors.background,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  photoBadgeText: { fontSize: 11, color: Colors.textSecondary, fontWeight: '600' },
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
});
