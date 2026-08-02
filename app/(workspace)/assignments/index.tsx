import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
  Platform,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { ScreenHeader } from '../../../components/ScreenHeader';
import { FormPicker } from '../../../components/FormPicker';
import { useAuth } from '../../../hooks/useAuth';
import { Colors } from '../../../constants/colors';
import {
  listAssignableUsers,
  listAssignmentsForDate,
  createAssignments,
  deleteAssignment,
  toDateKey,
  type AssignableUser,
} from '../../../lib/assignments';
import { forms as formsApi, type FormListItem } from '../../../lib/forms';
import { getFieldForm } from '../../../lib/settings';
import { notifyAssignmentCreated } from '../../../lib/notify';
import type { Assignment } from '../../../lib/types';

type AreaRow = { areaLabel: string; form: { id: string; title: string; url: string } | null };
const emptyAreaRow = (): AreaRow => ({ areaLabel: '', form: null });

export default function AssignmentsScreen() {
  const { isAdmin } = useAuth();
  const [date, setDate] = useState(new Date());
  const [showPicker, setShowPicker] = useState(false);
  const [users, setUsers] = useState<AssignableUser[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [formUser, setFormUser] = useState<AssignableUser | null>(null);
  const [areas, setAreas] = useState<AreaRow[]>([emptyAreaRow()]);
  const [saving, setSaving] = useState(false);
  const [formPickerRow, setFormPickerRow] = useState<number | null>(null);
  const [resolvingFormRow, setResolvingFormRow] = useState<number | null>(null);
  // The global "field form" (starred default) — shown on areas with no override.
  const [defaultForm, setDefaultForm] = useState<{ id: string; title: string } | null>(null);

  const dateKey = toDateKey(date);

  const load = useCallback(async () => {
    try {
      const [u, a] = await Promise.all([listAssignableUsers(), listAssignmentsForDate(dateKey)]);
      setUsers(u);
      setAssignments(a);
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to load assignments');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [dateKey]);

  useEffect(() => {
    if (isAdmin) load();
    else setLoading(false);
  }, [isAdmin, load]);

  // Resolve the starred/default field form's name once, so each area row with no
  // per-area override can show what will actually be assigned to the user. The
  // title comes from the forms list; fall back to a generic label if Google
  // isn't reachable, and leave null if no default is configured.
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      try {
        const ff = await getFieldForm();
        if (cancelled) return;
        if (!ff) return setDefaultForm(null);
        let title = 'Default field form';
        try {
          const list = await formsApi.list();
          if (!cancelled) title = list.find((f) => f.id === ff.id)?.title ?? title;
        } catch {
          /* Google not linked / offline — keep the generic label */
        }
        if (!cancelled) setDefaultForm({ id: ff.id, title });
      } catch {
        /* no default configured or fetch failed — leave as null */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  const byUser = useMemo(() => {
    const map = new Map<string, Assignment[]>();
    for (const a of assignments) {
      const arr = map.get(a.user_id) ?? [];
      arr.push(a);
      map.set(a.user_id, arr);
    }
    return map;
  }, [assignments]);

  if (!isAdmin) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Assignments" />
        <View style={styles.locked}>
          <Ionicons name="lock-closed-outline" size={32} color={Colors.textMuted} />
          <Text style={styles.lockedTitle}>Admin access required</Text>
        </View>
      </View>
    );
  }

  function openAdd(user: AssignableUser) {
    setFormUser(user);
    setAreas([emptyAreaRow()]);
  }

  function updateArea(i: number, text: string) {
    setAreas((prev) => prev.map((a, idx) => (idx === i ? { ...a, areaLabel: text } : a)));
  }
  function addArea() {
    setAreas((prev) => [...prev, emptyAreaRow()]);
  }
  function removeArea(i: number) {
    setAreas((prev) => (prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i)));
  }

  async function pickAreaForm(i: number, form: FormListItem) {
    setResolvingFormRow(i);
    try {
      const { uri } = await formsApi.responderUri(form.id);
      setAreas((prev) =>
        prev.map((a, idx) => (idx === i ? { ...a, form: { id: form.id, title: form.title, url: uri } } : a))
      );
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not load that form’s link');
    } finally {
      setResolvingFormRow(null);
    }
  }
  function clearAreaForm(i: number) {
    setAreas((prev) => prev.map((a, idx) => (idx === i ? { ...a, form: null } : a)));
  }

  async function save() {
    if (!formUser) return;
    const items = areas.filter((a) => a.areaLabel.trim());
    if (items.length === 0) return Alert.alert('Error', 'Add at least one area.');
    setSaving(true);
    try {
      const { created, failed } = await createAssignments({
        userId: formUser.id,
        dateKey,
        items: items.map((a) => ({ areaLabel: a.areaLabel, form: a.form })),
      });
      // Best-effort push to the assigned user, naming the area(s) that saved.
      const failedLabels = new Set(failed.map((f) => f.areaLabel));
      const okLabels = items.map((a) => a.areaLabel).filter((l) => !failedLabels.has(l));
      if (okLabels.length) void notifyAssignmentCreated(formUser.id, okLabels, dateKey);
      setFormUser(null);
      await load();
      if (failed.length) {
        Alert.alert(
          created ? 'Partly saved' : 'Could not save',
          `${created} added.\nFailed:\n` +
            failed.map((f) => `• ${f.areaLabel || '(blank)'} — ${f.error}`).join('\n')
        );
      }
    } catch (e: any) {
      Alert.alert('Could not save', e?.message ?? 'Failed to create assignments');
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete(a: Assignment) {
    Alert.alert('Remove assignment', a.area_label, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteAssignment(a.id);
            await load();
          } catch (e: any) {
            Alert.alert('Error', e?.message ?? 'Delete failed');
          }
        },
      },
    ]);
  }

  const prettyDate = date.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return (
    <View style={styles.container}>
      <ScreenHeader title="Assignments" />

      {/* Date picker */}
      <TouchableOpacity style={styles.dateBar} onPress={() => setShowPicker((v) => !v)} activeOpacity={0.8}>
        <Ionicons name="calendar-outline" size={18} color={Colors.primary} />
        <Text style={styles.dateText}>{prettyDate}</Text>
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
          {users.length === 0 && (
            <View style={styles.empty}>
              <Ionicons name="people-outline" size={28} color={Colors.textMuted} />
              <Text style={styles.emptyText}>No users yet. Add them in Team.</Text>
            </View>
          )}

          {users.map((u) => {
            const items = byUser.get(u.id) ?? [];
            return (
              <View key={u.id} style={styles.userCard}>
                <View style={styles.userHeader}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>
                      {(u.display_name || u.email).charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.userName} numberOfLines={1}>
                      {u.display_name || u.email.split('@')[0]}
                    </Text>
                    <Text style={styles.userEmail} numberOfLines={1}>
                      {u.email}
                    </Text>
                  </View>
                  <TouchableOpacity style={styles.addBtn} onPress={() => openAdd(u)}>
                    <Ionicons name="add" size={18} color="#fff" />
                    <Text style={styles.addBtnText}>Assign</Text>
                  </TouchableOpacity>
                </View>

                {items.length === 0 ? (
                  <Text style={styles.noItems}>No areas assigned for this date.</Text>
                ) : (
                  items.map((a, i) => (
                    <View key={a.id} style={styles.assignRow}>
                      <Text style={styles.assignNum}>{i + 1}.</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.assignArea} numberOfLines={2}>
                          {a.area_label}
                        </Text>
                      </View>
                      <TouchableOpacity onPress={() => confirmDelete(a)} hitSlop={8}>
                        <Ionicons name="trash-outline" size={18} color={Colors.error} />
                      </TouchableOpacity>
                    </View>
                  ))
                )}
              </View>
            );
          })}
        </ScrollView>
      )}

      {/* Add-assignment modal */}
      <Modal visible={!!formUser} animationType="slide" transparent onRequestClose={() => setFormUser(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                Assign · {formUser?.display_name || formUser?.email.split('@')[0]}
              </Text>
              <TouchableOpacity onPress={() => setFormUser(null)} hitSlop={8}>
                <Ionicons name="close" size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView
              contentContainerStyle={styles.form}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
            >
              {areas.map((area, i) => (
                <View key={i} style={styles.rowBlock}>
                  <View style={styles.rowBlockHeader}>
                    <Text style={styles.rowBlockTitle}>Area {i + 1}</Text>
                    {areas.length > 1 && (
                      <TouchableOpacity onPress={() => removeArea(i)} hitSlop={8}>
                        <Ionicons name="close-circle" size={20} color={Colors.textMuted} />
                      </TouchableOpacity>
                    )}
                  </View>

                  <TextInput
                    style={styles.input}
                    value={area.areaLabel}
                    onChangeText={(v) => updateArea(i, v)}
                    placeholder="e.g. Sector 4-7, Gurgaon"
                    placeholderTextColor={Colors.textMuted}
                  />
                  <Text style={styles.hint}>
                    The user will pick their exact place(s) within this area when they check in.
                  </Text>

                  {resolvingFormRow === i ? (
                    <View style={styles.formPickBtn}>
                      <ActivityIndicator size="small" color={Colors.primary} />
                      <Text style={styles.formPickText}>Loading form…</Text>
                    </View>
                  ) : area.form ? (
                    <View style={styles.formChip}>
                      <Ionicons name="document-text" size={16} color={Colors.primary} />
                      <Text style={styles.formChipText} numberOfLines={1}>
                        {area.form.title}
                      </Text>
                      <TouchableOpacity onPress={() => setFormPickerRow(i)} hitSlop={6}>
                        <Text style={styles.formChipAction}>Change</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => clearAreaForm(i)} hitSlop={6}>
                        <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <>
                      {defaultForm && (
                        <View style={styles.defaultFormChip}>
                          <Ionicons name="star" size={14} color={Colors.primary} />
                          <Text style={styles.defaultFormText} numberOfLines={1}>
                            {defaultForm.title}
                          </Text>
                          <Text style={styles.defaultFormTag}>will be assigned</Text>
                        </View>
                      )}
                      <TouchableOpacity style={styles.formPickBtn} onPress={() => setFormPickerRow(i)}>
                        <Ionicons name="swap-horizontal-outline" size={16} color={Colors.primary} />
                        <Text style={styles.formPickText}>Use a different form for this area</Text>
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              ))}

              <TouchableOpacity style={styles.addRowBtn} onPress={addArea} activeOpacity={0.8}>
                <Ionicons name="add-circle-outline" size={18} color={Colors.primary} />
                <Text style={styles.addRowText}>Add another area</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.saveBtn, saving && { opacity: 0.6 }]}
                onPress={save}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.saveBtnText}>
                    {areas.length > 1 ? `Add ${areas.length} areas` : 'Add area'}
                  </Text>
                )}
              </TouchableOpacity>
            </ScrollView>

            <FormPicker
              visible={formPickerRow !== null}
              onClose={() => setFormPickerRow(null)}
              onPick={(form) => {
                if (formPickerRow !== null) void pickAreaForm(formPickerRow, form);
              }}
            />
          </View>
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
  empty: { alignItems: 'center', gap: 8, paddingTop: 40 },
  emptyText: { fontSize: 14, color: Colors.textSecondary },
  userCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    gap: 10,
  },
  userHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: Colors.primary, fontWeight: '700', fontSize: 15 },
  userName: { fontSize: 15, fontWeight: '600', color: Colors.text },
  userEmail: { fontSize: 12, color: Colors.textSecondary, marginTop: 1 },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: Colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 9,
  },
  addBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  noItems: { fontSize: 13, color: Colors.textMuted, fontStyle: 'italic' },
  assignRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
    paddingTop: 10,
  },
  assignNum: { fontSize: 13, fontWeight: '700', color: Colors.textSecondary, marginTop: 1 },
  assignArea: { fontSize: 14, color: Colors.text, fontWeight: '500' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: Colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 28,
    maxHeight: '88%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: Colors.text, flex: 1 },
  form: { paddingHorizontal: 20, paddingTop: 4, gap: 8 },
  rowBlock: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    gap: 6,
  },
  rowBlockHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  rowBlockTitle: { fontSize: 14, fontWeight: '700', color: Colors.text },
  addRowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 11,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.primary,
    marginTop: 4,
  },
  addRowText: { color: Colors.primary, fontSize: 14, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.text,
    backgroundColor: Colors.surface,
  },
  hint: { fontSize: 12, color: Colors.textMuted },
  formPickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: Colors.surface,
    marginTop: 8,
  },
  formPickText: { fontSize: 13, color: Colors.primary, fontWeight: '600', flex: 1 },
  formChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.primary,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: Colors.primaryLight,
    marginTop: 8,
  },
  formChipText: { flex: 1, fontSize: 13, color: Colors.text, fontWeight: '500' },
  formChipAction: { fontSize: 12, color: Colors.primary, fontWeight: '700' },
  defaultFormChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: Colors.primaryLight,
    marginTop: 8,
  },
  defaultFormText: { flex: 1, fontSize: 13, color: Colors.text, fontWeight: '600' },
  defaultFormTag: { fontSize: 11, color: Colors.textMuted, fontWeight: '600' },
  saveBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 14,
  },
  saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
