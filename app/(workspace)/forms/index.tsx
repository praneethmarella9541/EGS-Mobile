import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  TextInput,
  RefreshControl,
  Platform,
  Switch,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { format } from 'date-fns';
import { FormSheet } from '../../../components/FormSheet';
import { ScreenHeader } from '../../../components/ScreenHeader';
import { useAuth } from '../../../hooks/useAuth';
import { Colors } from '../../../constants/colors';
import { forms, type FormListItem } from '../../../lib/forms';
import { getFieldForm, setFieldForm, getIncludeVisitContext, setIncludeVisitContext } from '../../../lib/settings';

export default function FormsScreen() {
  const router = useRouter();
  const { isAdmin } = useAuth();
  const [items, setItems] = useState<FormListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [fieldFormId, setFieldFormId] = useState<string | null>(null);
  const [settingId, setSettingId] = useState<string | null>(null);
  const [includeContext, setIncludeContextState] = useState(false);
  const [contextToggling, setContextToggling] = useState(false);
  // Public responder URLs by form id (from public.forms) — lets copy-link skip
  // the Google round-trip for app-created forms.
  const [responderCache, setResponderCache] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const [list, fieldForm, includeVisitContext, responderMap] = await Promise.all([
        forms.list(),
        getFieldForm(),
        getIncludeVisitContext(),
        forms.cachedResponderUris(),
      ]);
      setItems(list);
      setFieldFormId(fieldForm?.id ?? null);
      setIncludeContextState(includeVisitContext);
      setResponderCache(responderMap);
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to load forms');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Fires on mount AND when returning from the editor (title may have
  // changed). A separate plain useEffect(load) here would double up on mount
  // (useFocusEffect already fires then too) — that duplicate call raced the
  // context-question provisioning below and created each question twice.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (!isAdmin) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Forms" />
        <View style={styles.locked}>
          <Ionicons name="lock-closed-outline" size={32} color={Colors.textMuted} />
          <Text style={styles.lockedTitle}>Admin access required</Text>
        </View>
      </View>
    );
  }

  async function create() {
    if (!title.trim()) return Alert.alert('Error', 'Enter a form title.');
    setCreating(true);
    try {
      const { form, titleWarning } = await forms.create(title.trim());
      setShowCreate(false);
      setTitle('');
      // Optimistic: show the new form immediately instead of refetching the
      // entire Drive forms list (that list-all call is the delay). It also
      // refreshes on focus when returning from the editor.
      setItems((prev) => [
        { id: form.id, title: form.title, modifiedTime: new Date().toISOString() },
        ...prev,
      ]);
      setResponderCache((prev) => ({ ...prev, [form.id]: form.responder_uri }));
      if (titleWarning) {
        Alert.alert('Title may not show correctly', `Google rejected setting the Drive file name: ${titleWarning}`);
      }
      // jump straight into the editor
      router.push(`/(workspace)/forms/${form.id}/edit` as any);
    } catch (e: any) {
      Alert.alert('Could not create form', e?.message ?? 'Failed');
    } finally {
      setCreating(false);
    }
  }

  function openEditor(form: FormListItem) {
    router.push(`/(workspace)/forms/${form.id}/edit` as any);
  }

  async function copyLink(form: FormListItem) {
    try {
      // Fast path: use the cached public URL (no Google call) if we have it.
      const cached = responderCache[form.id];
      if (cached) {
        await Clipboard.setStringAsync(cached);
        Alert.alert('Copied', 'Responder link copied.');
        return;
      }
      const { uri, shareWarning } = await forms.responderUri(form.id);
      if (!uri) throw new Error('No responder link found.');
      await Clipboard.setStringAsync(uri);
      setResponderCache((prev) => ({ ...prev, [form.id]: uri }));
      if (shareWarning) {
        Alert.alert(
          'Copied, but may need sign-in',
          `Link copied. Google would not make it sign-in-free: ${shareWarning}`
        );
      } else {
        Alert.alert('Copied', 'Responder link copied.');
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not get link');
    }
  }

  async function makeFieldForm(form: FormListItem) {
    // Shift the star immediately (optimistic) — the actual work (responder link,
    // public sharing, no-login prep, DB write) makes several Google round-trips
    // and would otherwise leave the star "stuck" on the old form until it's done.
    const prevId = fieldFormId;
    if (prevId === form.id) return;
    setFieldFormId(form.id);
    setSettingId(form.id);
    try {
      const { uri, shareWarning } = await forms.responderUri(form.id);
      if (!uri) throw new Error('No responder link found.');
      setResponderCache((prev) => ({ ...prev, [form.id]: uri }));
      await setFieldForm(form.id, uri);
      if (shareWarning) {
        Alert.alert(
          'Set, but may need sign-in',
          `"${form.title}" is now the field form. Google would not make it sign-in-free: ${shareWarning}`
        );
      }
    } catch (e: any) {
      setFieldFormId(prevId); // revert the star on failure
      Alert.alert('Error', e?.message ?? 'Could not set as field form');
    } finally {
      setSettingId(null);
    }
  }

  async function toggleIncludeContext(value: boolean) {
    setContextToggling(true);
    setIncludeContextState(value);
    try {
      await setIncludeVisitContext(value);
    } catch (e: any) {
      setIncludeContextState(!value);
      Alert.alert('Error', e?.message ?? 'Could not update setting');
    } finally {
      setContextToggling(false);
    }
  }

  function confirmDelete(form: FormListItem) {
    Alert.alert('Delete form', `Delete "${form.title}"? This removes it from Google too.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          // Optimistic: remove it from the list immediately, delete in the
          // background, and restore it if the delete fails.
          const prevItems = items;
          const prevFieldFormId = fieldFormId;
          setItems((prev) => prev.filter((f) => f.id !== form.id));
          if (fieldFormId === form.id) setFieldFormId(null);
          try {
            await forms.remove(form.id);
          } catch (e: any) {
            setItems(prevItems);
            setFieldFormId(prevFieldFormId);
            Alert.alert('Error', e?.message ?? 'Delete failed');
          }
        },
      },
    ]);
  }

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Forms"
        right={
          <TouchableOpacity onPress={() => setShowCreate(true)} hitSlop={8} accessibilityLabel="New form">
            <Ionicons name="add-circle" size={26} color={Colors.primary} />
          </TouchableOpacity>
        }
      />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : (
        <>
          {/* "Verified visit details" toggle intentionally hidden from the UI.
              The setting itself is untouched — its stored value still drives the
              Responses view (see FormResponsesTab / getIncludeVisitContext). */}
          <FlatList
          data={items}
          keyExtractor={(f) => f.id}
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
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="document-text-outline" size={30} color={Colors.textMuted} />
              <Text style={styles.emptyText}>No forms yet. Tap ＋ to create one.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.card}>
              <TouchableOpacity style={styles.cardMain} onPress={() => openEditor(item)} activeOpacity={0.7}>
                <View style={styles.formIcon}>
                  <Ionicons name="document-text" size={20} color={Colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.formTitle} numberOfLines={1}>
                      {item.title}
                    </Text>
                    {fieldFormId === item.id ? (
                      <View style={styles.fieldFormBadge}>
                        <Text style={styles.fieldFormBadgeText}>FIELD FORM</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.formSub}>
                    {item.modifiedTime
                      ? `Edited ${format(new Date(item.modifiedTime), 'MMM d, yyyy')}`
                      : 'Tap to edit'}
                  </Text>
                </View>
              </TouchableOpacity>
              <View style={styles.actions}>
                <TouchableOpacity
                  style={[styles.actionBtn, settingId === item.id && { opacity: 0.5 }]}
                  onPress={() => makeFieldForm(item)}
                  disabled={settingId === item.id || fieldFormId === item.id}
                  accessibilityLabel={fieldFormId === item.id ? 'Field form' : 'Set as field form'}
                >
                  {/* Star reflects the (optimistic) selection immediately; the
                      background sharing/prep work just dims the button, so the
                      star shifts instantly instead of hiding behind a spinner. */}
                  <Ionicons
                    name={fieldFormId === item.id ? 'star' : 'star-outline'}
                    size={20}
                    color={fieldFormId === item.id ? Colors.primary : Colors.textSecondary}
                  />
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionBtn} onPress={() => copyLink(item)} accessibilityLabel="Copy link">
                  <Ionicons name="link-outline" size={20} color={Colors.textSecondary} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionBtn} onPress={() => openEditor(item)} accessibilityLabel="Edit">
                  <Ionicons name="create-outline" size={20} color={Colors.textSecondary} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionBtn} onPress={() => confirmDelete(item)} accessibilityLabel="Delete">
                  <Ionicons name="trash-outline" size={20} color={Colors.error} />
                </TouchableOpacity>
              </View>
            </View>
          )}
          />
        </>
      )}

      <FormSheet
        visible={showCreate}
        onRequestClose={() => setShowCreate(false)}
        justify="center"
        backdropStyle={{ alignItems: 'center', padding: 28 }}
      >
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>New form</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="Form title"
            placeholderTextColor={Colors.textMuted}
            autoFocus
          />
          <View style={styles.modalBtns}>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowCreate(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.createBtn, creating && { opacity: 0.6 }]} onPress={create} disabled={creating}>
              {creating ? <ActivityIndicator color="#fff" /> : <Text style={styles.createText}>Create</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </FormSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  locked: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  lockedTitle: { fontSize: 17, fontWeight: '700', color: Colors.text },
  list: { padding: 16, paddingBottom: 40, gap: 12 },
  contextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 16,
    marginTop: 14,
    padding: 14,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  contextTitle: { fontSize: 14, fontWeight: '600', color: Colors.text },
  contextSub: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  empty: { alignItems: 'center', gap: 8, paddingTop: 60 },
  emptyText: { fontSize: 14, color: Colors.textSecondary },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  cardMain: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  formIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  formTitle: { fontSize: 15, fontWeight: '600', color: Colors.text, flexShrink: 1 },
  formSub: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  fieldFormBadge: {
    backgroundColor: Colors.primaryLight,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  fieldFormBadgeText: { fontSize: 9, fontWeight: '700', color: Colors.primary, letterSpacing: 0.4 },
  actions: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  actionBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  modalCard: {
    width: '100%',
    backgroundColor: Colors.surface,
    borderRadius: 18,
    padding: 20,
    gap: 14,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: Colors.text },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.text,
    backgroundColor: Colors.background,
  },
  modalBtns: { flexDirection: 'row', gap: 10 },
  cancelBtn: { flex: 1, paddingVertical: 13, alignItems: 'center', borderRadius: 10, backgroundColor: Colors.borderLight },
  cancelText: { fontSize: 15, fontWeight: '600', color: Colors.textSecondary },
  createBtn: { flex: 1, paddingVertical: 13, alignItems: 'center', borderRadius: 10, backgroundColor: Colors.primary },
  createText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
