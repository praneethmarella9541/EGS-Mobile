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
  KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { ScreenHeader } from '../../../components/ScreenHeader';
import { AddressAutocomplete } from '../../../components/AddressAutocomplete';
import { FormPicker } from '../../../components/FormPicker';
import { forms as formsApi, type FormListItem } from '../../../lib/forms';
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
import type { Assignment } from '../../../lib/types';

type Row = { address: string; formUrl: string; formTitle?: string; lat?: number; lng?: number };
const emptyRow = (): Row => ({ address: '', formUrl: '' });

export default function AssignmentsScreen() {
  const { isAdmin } = useAuth();
  const [date, setDate] = useState(new Date());
  const [showPicker, setShowPicker] = useState(false);
  const [users, setUsers] = useState<AssignableUser[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [formUser, setFormUser] = useState<AssignableUser | null>(null);
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [saving, setSaving] = useState(false);
  const [pickerRow, setPickerRow] = useState<number | null>(null);
  const [resolvingRow, setResolvingRow] = useState<number | null>(null);

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
    setRows([emptyRow()]);
  }

  function updateRow(i: number, field: keyof Row, value: string) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  }
  // Typing free text invalidates any previously picked coordinates.
  function setRowAddressText(i: number, text: string) {
    setRows((prev) =>
      prev.map((r, idx) => (idx === i ? { ...r, address: text, lat: undefined, lng: undefined } : r))
    );
  }
  function pickRowAddress(i: number, pick: { label: string; lat: number; lng: number }) {
    setRows((prev) =>
      prev.map((r, idx) =>
        idx === i ? { ...r, address: pick.label, lat: pick.lat, lng: pick.lng } : r
      )
    );
  }
  async function pickRowForm(i: number, form: FormListItem) {
    setResolvingRow(i);
    try {
      const { uri, shareWarning } = await formsApi.responderUri(form.id);
      setRows((prev) =>
        prev.map((r, idx) => (idx === i ? { ...r, formUrl: uri, formTitle: form.title } : r))
      );
      if (shareWarning) {
        Alert.alert(
          'Form may require sign-in',
          `Could not make "${form.title}" link-shareable, so field users may hit a Google sign-in wall when opening it:\n\n${shareWarning}`
        );
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not load that form’s link');
    } finally {
      setResolvingRow(null);
    }
  }
  function clearRowForm(i: number) {
    setRows((prev) =>
      prev.map((r, idx) => (idx === i ? { ...r, formUrl: '', formTitle: undefined } : r))
    );
  }
  function addRow() {
    setRows((prev) => [...prev, emptyRow()]);
  }
  function removeRow(i: number) {
    setRows((prev) => (prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i)));
  }

  async function save() {
    if (!formUser) return;
    const items = rows
      .map((r) => ({ address: r.address.trim(), formUrl: r.formUrl.trim(), lat: r.lat, lng: r.lng }))
      .filter((r) => r.address || r.formUrl);
    if (items.length === 0) return Alert.alert('Error', 'Add at least one location.');
    const incomplete = items.find((r) => !r.address || !r.formUrl);
    if (incomplete) {
      return Alert.alert('Error', 'Each location needs both an address and a form link.');
    }
    setSaving(true);
    try {
      const { created, failed } = await createAssignments({
        userId: formUser.id,
        dateKey,
        items,
      });
      setFormUser(null);
      await load();
      if (failed.length) {
        Alert.alert(
          created ? 'Partly saved' : 'Could not save',
          `${created} added.\nFailed:\n` +
            failed.map((f) => `• ${f.address || '(blank)'} — ${f.error}`).join('\n')
        );
      }
    } catch (e: any) {
      Alert.alert('Could not save', e?.message ?? 'Failed to create assignments');
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete(a: Assignment) {
    Alert.alert('Remove assignment', a.location_label, [
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
      <TouchableOpacity style={styles.dateBar} onPress={() => setShowPicker(true)} activeOpacity={0.8}>
        <Ionicons name="calendar-outline" size={18} color={Colors.primary} />
        <Text style={styles.dateText}>{prettyDate}</Text>
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
                  <Text style={styles.noItems}>No locations assigned for this date.</Text>
                ) : (
                  items.map((a, i) => (
                    <View key={a.id} style={styles.assignRow}>
                      <Text style={styles.assignNum}>{i + 1}.</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.assignLoc} numberOfLines={2}>
                          {a.location_label}
                        </Text>
                        <Text style={styles.assignForm} numberOfLines={1}>
                          {a.form_url}
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
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
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
              {rows.map((row, i) => (
                <View key={i} style={styles.rowBlock}>
                  <View style={styles.rowBlockHeader}>
                    <Text style={styles.rowBlockTitle}>Location {i + 1}</Text>
                    {rows.length > 1 && (
                      <TouchableOpacity onPress={() => removeRow(i)} hitSlop={8}>
                        <Ionicons name="close-circle" size={20} color={Colors.textMuted} />
                      </TouchableOpacity>
                    )}
                  </View>

                  <Text style={styles.fieldLabel}>Address</Text>
                  <AddressAutocomplete
                    value={row.address}
                    onChangeText={(v) => setRowAddressText(i, v)}
                    onSelect={(pick) => pickRowAddress(i, pick)}
                    placeholder="Search address…"
                  />
                  {row.lat != null ? (
                    <Text style={styles.coordOk}>
                      ✓ Location pinned ({row.lat.toFixed(5)}, {row.lng!.toFixed(5)})
                    </Text>
                  ) : (
                    <Text style={styles.hint}>
                      Pick a suggestion to pin the exact spot (used for geo-verification).
                    </Text>
                  )}

                  <Text style={[styles.fieldLabel, { marginTop: 8 }]}>Google Form</Text>
                  {resolvingRow === i ? (
                    <View style={styles.formPickBtn}>
                      <ActivityIndicator size="small" color={Colors.primary} />
                      <Text style={styles.formPickText}>Loading form…</Text>
                    </View>
                  ) : row.formUrl ? (
                    <View style={styles.formChip}>
                      <Ionicons name="document-text" size={16} color={Colors.primary} />
                      <Text style={styles.formChipText} numberOfLines={1}>
                        {row.formTitle || 'Selected form'}
                      </Text>
                      <TouchableOpacity onPress={() => setPickerRow(i)} hitSlop={6}>
                        <Text style={styles.formChipAction}>Change</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => clearRowForm(i)} hitSlop={6}>
                        <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity style={styles.formPickBtn} onPress={() => setPickerRow(i)}>
                      <Ionicons name="search" size={16} color={Colors.primary} />
                      <Text style={styles.formPickText}>Select a form</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}

              <TouchableOpacity style={styles.addRowBtn} onPress={addRow} activeOpacity={0.8}>
                <Ionicons name="add-circle-outline" size={18} color={Colors.primary} />
                <Text style={styles.addRowText}>Add another location</Text>
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
                    {rows.length > 1 ? `Add ${rows.length} assignments` : 'Add assignment'}
                  </Text>
                )}
              </TouchableOpacity>
            </ScrollView>

            <FormPicker
              visible={pickerRow !== null}
              onClose={() => setPickerRow(null)}
              onPick={(form) => {
                if (pickerRow !== null) void pickRowForm(pickerRow, form);
              }}
            />
          </View>
        </KeyboardAvoidingView>
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
  assignLoc: { fontSize: 14, color: Colors.text, fontWeight: '500' },
  assignForm: { fontSize: 12, color: Colors.info, marginTop: 2 },
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
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
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
  coordOk: { fontSize: 12, color: Colors.success, fontWeight: '600' },
  formPickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: Colors.surface,
  },
  formPickText: { fontSize: 15, color: Colors.primary, fontWeight: '600' },
  formChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.primary,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: Colors.primaryLight,
  },
  formChipText: { flex: 1, fontSize: 14, color: Colors.text, fontWeight: '500' },
  formChipAction: { fontSize: 13, color: Colors.primary, fontWeight: '700' },
  saveBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 14,
  },
  saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
