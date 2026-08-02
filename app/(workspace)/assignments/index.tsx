import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  TextInput,
  Platform,
  RefreshControl,
  Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { FormSheet } from '../../../components/FormSheet';
import { ScreenHeader } from '../../../components/ScreenHeader';
import { MultiFormPicker } from '../../../components/MultiFormPicker';
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

type AreaFormSel = { id: string; title: string; url: string };
// forms === null → not customized (defaults to the starred field form at read
// time); an array (even empty) → the admin explicitly picked this exact set.
type AreaRow = { areaLabel: string; forms: AreaFormSel[] | null };
const emptyAreaRow = (): AreaRow => ({ areaLabel: '', forms: null });

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
  const [multiFormPickerRow, setMultiFormPickerRow] = useState<number | null>(null);
  const [resolvingFormsRow, setResolvingFormsRow] = useState<number | null>(null);
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

  /** Dismiss the area-label keyboard before opening the picker — it should only
   *  reappear if the admin taps the picker's own search field. */
  function openMultiFormPicker(i: number) {
    Keyboard.dismiss();
    setMultiFormPickerRow(i);
  }

  /** Resolve each checked form's public responder URL (cache first, then a per-form call) and store the set on the row. */
  async function confirmAreaForms(i: number, selected: FormListItem[]) {
    setResolvingFormsRow(i);
    try {
      const cache = await formsApi.cachedResponderUris();
      const resolved = await Promise.all(
        selected.map(async (f): Promise<AreaFormSel> => {
          const cached = cache[f.id];
          if (cached) return { id: f.id, title: f.title, url: cached };
          const { uri } = await formsApi.responderUri(f.id);
          return { id: f.id, title: f.title, url: uri };
        })
      );
      setAreas((prev) => prev.map((a, idx) => (idx === i ? { ...a, forms: resolved } : a)));
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not load form links');
    } finally {
      setResolvingFormsRow(null);
    }
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
        items: items.map((a) => ({ areaLabel: a.areaLabel, forms: a.forms })),
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
                        {a.forms_customized && (
                          <Text style={styles.assignFormsNote} numberOfLines={1}>
                            {a.forms && a.forms.length > 0
                              ? `Forms: ${a.forms.map((f) => f.form_title).join(', ')}`
                              : 'No form attached'}
                          </Text>
                        )}
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
      <FormSheet visible={!!formUser} onRequestClose={() => setFormUser(null)}>
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

                  {resolvingFormsRow === i ? (
                    <View style={styles.formPickBtn}>
                      <ActivityIndicator size="small" color={Colors.primary} />
                      <Text style={styles.formPickText}>Loading form links…</Text>
                    </View>
                  ) : area.forms !== null ? (
                    <>
                      {area.forms.length > 0 ? (
                        <View style={styles.formsChipsWrap}>
                          {area.forms.map((f) => (
                            <View key={f.id} style={styles.formChip}>
                              <Ionicons name="document-text" size={14} color={Colors.primary} />
                              <Text style={styles.formChipText} numberOfLines={1}>
                                {f.title}
                              </Text>
                            </View>
                          ))}
                        </View>
                      ) : (
                        <Text style={styles.hint}>No forms will be assigned for this area.</Text>
                      )}
                      <TouchableOpacity style={styles.formPickBtn} onPress={() => openMultiFormPicker(i)}>
                        <Ionicons name="create-outline" size={16} color={Colors.primary} />
                        <Text style={styles.formPickText}>Edit forms for this area</Text>
                      </TouchableOpacity>
                    </>
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
                      <TouchableOpacity style={styles.formPickBtn} onPress={() => openMultiFormPicker(i)}>
                        <Ionicons name="add-circle-outline" size={16} color={Colors.primary} />
                        <Text style={styles.formPickText}>Add more forms for this area</Text>
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
          </View>
      </FormSheet>

      {/* Rendered at the screen root, NOT inside the assign FormSheet: nested
          inside, its full-screen overlay was clipped to the sheet's card and it
          shared the sheet's back handler, so dismissing the picker tore down the
          whole assign flow. As a sibling it floats above the still-open sheet
          and only closes itself — the sheet stays until Add area / close. */}
      <MultiFormPicker
        visible={multiFormPickerRow !== null}
        onClose={() => setMultiFormPickerRow(null)}
        initialSelectedIds={
          multiFormPickerRow !== null && areas[multiFormPickerRow]
            ? (areas[multiFormPickerRow].forms
                ? areas[multiFormPickerRow].forms!.map((f) => f.id)
                : defaultForm
                  ? [defaultForm.id]
                  : [])
            : []
        }
        defaultFormId={defaultForm?.id ?? null}
        onConfirm={(selected) => {
          if (multiFormPickerRow !== null) void confirmAreaForms(multiFormPickerRow, selected);
        }}
      />
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
  list: { padding: 16, paddingBottom: 40, gap: 14 },
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
  assignFormsNote: { fontSize: 11, color: Colors.textMuted, marginTop: 2 },
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
  form: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 32, gap: 8 },
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
  formsChipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  formChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '100%',
    borderWidth: 1,
    borderColor: Colors.primary,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: Colors.primaryLight,
  },
  formChipText: { fontSize: 13, color: Colors.text, fontWeight: '500', flexShrink: 1 },
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
