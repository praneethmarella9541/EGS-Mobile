import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  BackHandler,
  KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { forms, type FormListItem } from '../lib/forms';

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Form ids already selected for this area (pre-checked when the list loads). */
  initialSelectedIds: string[];
  onConfirm: (selected: FormListItem[]) => void;
  /** Shown next to the starred/default form so it's clear why it's pre-checked. */
  defaultFormId?: string | null;
};

/** Searchable, multi-select list of the admin's Google Forms — check any number to attach to an area. */
export function MultiFormPicker({
  visible,
  onClose,
  initialSelectedIds,
  onConfirm,
  defaultFormId,
}: Props) {
  const [items, setItems] = useState<FormListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!visible) return;
    setQuery('');
    setError(null);
    setSelectedIds(new Set(initialSelectedIds));
    setLoading(true);
    forms
      .list()
      .then(setItems)
      .catch((e) => setError(e?.message ?? 'Failed to load forms'))
      .finally(() => setLoading(false));
    // Only re-run when the sheet opens, not on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Back closes only this picker. Registered while open, so it runs before the
  // parent sheet's handler and stops the whole assign flow from being dismissed.
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  // Starred/default form first, then everything else as returned.
  const ordered = useMemo(() => {
    if (!defaultFormId) return items;
    const idx = items.findIndex((f) => f.id === defaultFormId);
    if (idx <= 0) return items;
    const copy = items.slice();
    const [def] = copy.splice(idx, 1);
    copy.unshift(def);
    return copy;
  }, [items, defaultFormId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ordered;
    return ordered.filter((f) => f.title.toLowerCase().includes(q));
  }, [ordered, query]);

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function confirm() {
    const selected = items.filter((f) => selectedIds.has(f.id));
    onConfirm(selected);
    onClose();
  }

  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      <KeyboardAvoidingView style={styles.backdrop} behavior="padding">
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Forms for this area</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={24} color={Colors.text} />
            </TouchableOpacity>
          </View>

          <View style={styles.searchRow}>
            <Ionicons name="search" size={18} color={Colors.textMuted} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search forms…"
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="none"
            />
          </View>

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={Colors.primary} />
            </View>
          ) : error ? (
            <View style={styles.center}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={(f) => f.id}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 12 }}
              ListEmptyComponent={
                <Text style={styles.empty}>
                  {items.length === 0 ? 'No forms found in your Google account.' : 'No matches.'}
                </Text>
              }
              renderItem={({ item }) => {
                const checked = selectedIds.has(item.id);
                const isDefault = item.id === defaultFormId;
                return (
                  <TouchableOpacity style={styles.row} onPress={() => toggle(item.id)} activeOpacity={0.7}>
                    <Ionicons
                      name={checked ? 'checkbox' : 'square-outline'}
                      size={22}
                      color={checked ? Colors.primary : Colors.textMuted}
                    />
                    <Text style={styles.rowText} numberOfLines={1}>
                      {item.title}
                    </Text>
                    {isDefault && (
                      <View style={styles.defaultTag}>
                        <Ionicons name="star" size={11} color={Colors.primary} />
                        <Text style={styles.defaultTagText}>Default</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              }}
            />
          )}

          <TouchableOpacity style={styles.confirmBtn} onPress={confirm} activeOpacity={0.85}>
            <Text style={styles.confirmBtnText}>
              {selectedIds.size > 0 ? `Attach ${selectedIds.size} form${selectedIds.size > 1 ? 's' : ''}` : 'Attach no forms'}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 30, elevation: 30 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.background,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 10,
    paddingHorizontal: 0,
    height: '80%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  title: { fontSize: 18, fontWeight: '700', color: Colors.text },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  searchInput: { flex: 1, paddingVertical: 11, fontSize: 15, color: Colors.text },
  center: { padding: 40, alignItems: 'center' },
  errorText: { color: Colors.error, fontSize: 13, textAlign: 'center' },
  empty: { textAlign: 'center', color: Colors.textSecondary, paddingVertical: 30, fontSize: 14 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 14,
    backgroundColor: Colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  rowText: { flex: 1, fontSize: 15, color: Colors.text },
  defaultTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.primaryLight,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  defaultTagText: { fontSize: 10, fontWeight: '700', color: Colors.primary },
  confirmBtn: {
    backgroundColor: Colors.primary,
    marginHorizontal: 16,
    marginVertical: 12,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  confirmBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
