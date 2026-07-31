import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
  RefreshControl,
  Platform,
  KeyboardAvoidingView,
  Switch,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { format } from 'date-fns';
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

  const load = useCallback(async () => {
    try {
      const [list, fieldForm, includeVisitContext] = await Promise.all([
        forms.list(),
        getFieldForm(),
        getIncludeVisitContext(),
      ]);
      setItems(list);
      setFieldFormId(fieldForm?.id ?? null);
      setIncludeContextState(includeVisitContext);
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
      await load();
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
      const { uri, shareWarning } = await forms.responderUri(form.id);
      if (!uri) throw new Error('No responder link found.');
      await Clipboard.setStringAsync(uri);
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
    setSettingId(form.id);
    try {
      const { uri, shareWarning } = await forms.responderUri(form.id);
      if (!uri) throw new Error('No responder link found.');
      await setFieldForm(form.id, uri);
      setFieldFormId(form.id);
      if (shareWarning) {
        Alert.alert(
          'Set, but may need sign-in',
          `"${form.title}" is now the field form. Google would not make it sign-in-free: ${shareWarning}`
        );
      }
    } catch (e: any) {
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
          try {
            await forms.remove(form.id);
            await load();
          } catch (e: any) {
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
          <View style={styles.contextRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.contextTitle}>Verified visit details</Text>
              <Text style={styles.contextSub}>
                Shows who, which location, and when — from the app's own records, not editable in the
                form — alongside each response.
              </Text>
            </View>
            {contextToggling ? (
              <ActivityIndicator color={Colors.primary} />
            ) : (
              <Switch
                value={includeContext}
                onValueChange={toggleIncludeContext}
                trackColor={{ false: Colors.border, true: Colors.primaryLight }}
                thumbColor={includeContext ? Colors.primary : undefined}
              />
            )}
          </View>
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
                  style={styles.actionBtn}
                  onPress={() => makeFieldForm(item)}
                  disabled={settingId === item.id || fieldFormId === item.id}
                  accessibilityLabel={fieldFormId === item.id ? 'Field form' : 'Set as field form'}
                >
                  {settingId === item.id ? (
                    <ActivityIndicator size="small" color={Colors.primary} />
                  ) : (
                    <Ionicons
                      name={fieldFormId === item.id ? 'star' : 'star-outline'}
                      size={20}
                      color={fieldFormId === item.id ? Colors.primary : Colors.textSecondary}
                    />
                  )}
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

      <Modal visible={showCreate} transparent animationType="fade" onRequestClose={() => setShowCreate(false)}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
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
  list: { padding: 16, gap: 12 },
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
