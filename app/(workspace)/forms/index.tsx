import React, { useCallback, useEffect, useState } from 'react';
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
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { format } from 'date-fns';
import { ScreenHeader } from '../../../components/ScreenHeader';
import { useAuth } from '../../../hooks/useAuth';
import { Colors } from '../../../constants/colors';
import { forms, type FormListItem } from '../../../lib/forms';

export default function FormsScreen() {
  const router = useRouter();
  const { isAdmin } = useAuth();
  const [items, setItems] = useState<FormListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await forms.list());
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to load forms');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Refresh when returning from the editor (title may have changed).
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
      const { form } = await forms.create(title.trim());
      setShowCreate(false);
      setTitle('');
      await load();
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
                  <Text style={styles.formTitle} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={styles.formSub}>
                    {item.modifiedTime
                      ? `Edited ${format(new Date(item.modifiedTime), 'MMM d, yyyy')}`
                      : 'Tap to edit'}
                  </Text>
                </View>
              </TouchableOpacity>
              <View style={styles.actions}>
                <TouchableOpacity style={styles.actionBtn} onPress={() => copyLink(item)}>
                  <Ionicons name="link-outline" size={18} color={Colors.textSecondary} />
                  <Text style={styles.actionText}>Copy link</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionBtn} onPress={() => openEditor(item)}>
                  <Ionicons name="create-outline" size={18} color={Colors.textSecondary} />
                  <Text style={styles.actionText}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionBtn} onPress={() => confirmDelete(item)}>
                  <Ionicons name="trash-outline" size={18} color={Colors.error} />
                </TouchableOpacity>
              </View>
            </View>
          )}
        />
      )}

      <Modal visible={showCreate} transparent animationType="fade" onRequestClose={() => setShowCreate(false)}>
        <View style={styles.modalBackdrop}>
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
  list: { padding: 16, gap: 12 },
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
  formTitle: { fontSize: 15, fontWeight: '600', color: Colors.text },
  formSub: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  actions: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
  },
  actionText: { fontSize: 13, color: Colors.textSecondary, fontWeight: '500' },
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
