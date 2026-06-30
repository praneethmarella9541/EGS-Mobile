import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '../../../components/ScreenHeader';
import { useAuth } from '../../../hooks/useAuth';
import { Colors } from '../../../constants/colors';
import { adminUsers, type TeamMember } from '../../../lib/admin-users';

export default function AdminScreen() {
  const { isAdmin } = useAuth();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [saving, setSaving] = useState(false);

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [mobile, setMobile] = useState('');

  const load = useCallback(async () => {
    try {
      const { members } = await adminUsers.list();
      setMembers(members);
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to load users');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) load();
    else setLoading(false);
  }, [isAdmin, load]);

  if (!isAdmin) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Team" />
        <View style={styles.locked}>
          <Ionicons name="lock-closed-outline" size={32} color={Colors.textMuted} />
          <Text style={styles.lockedTitle}>Admin access required</Text>
          <Text style={styles.lockedSub}>Only admins can manage team members.</Text>
        </View>
      </View>
    );
  }

  function openAdd() {
    setEditing(null);
    setEmail('');
    setName('');
    setPassword('');
    setMobile('');
    setShowForm(true);
  }

  function openEdit(m: TeamMember) {
    setEditing(m);
    setEmail(m.email);
    setName(m.display_name ?? '');
    setPassword('');
    setMobile(m.mobile_phone ?? '');
    setShowForm(true);
  }

  async function save() {
    if (!email.trim()) return Alert.alert('Error', 'Email is required.');
    if (!editing && !password) return Alert.alert('Error', 'Password is required for new users.');
    setSaving(true);
    try {
      if (editing) {
        await adminUsers.update({
          id: editing.id,
          email: email.trim().toLowerCase(),
          display_name: name.trim() || null,
          mobile_phone: mobile.trim() || null,
          ...(password ? { password } : {}),
        });
      } else {
        await adminUsers.create({
          email: email.trim().toLowerCase(),
          password,
          display_name: name.trim() || null,
          mobile_phone: mobile.trim() || null,
        });
      }
      setShowForm(false);
      await load();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  function remove(m: TeamMember) {
    Alert.alert('Delete user', `Remove ${m.display_name || m.email}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await adminUsers.remove(m.id);
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
        title="Team"
        right={
          <TouchableOpacity onPress={openAdd} hitSlop={8} accessibilityLabel="Add user">
            <Ionicons name="person-add-outline" size={22} color={Colors.primary} />
          </TouchableOpacity>
        }
      />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : (
        <FlatList
          data={members}
          keyExtractor={(m) => m.id}
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
              <Ionicons name="people-outline" size={30} color={Colors.textMuted} />
              <Text style={styles.emptyText}>No users yet. Tap the icon to add one.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.row} onPress={() => openEdit(item)} activeOpacity={0.7}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {(item.display_name || item.email).charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName} numberOfLines={1}>
                  {item.display_name || item.email.split('@')[0]}
                </Text>
                <Text style={styles.rowEmail} numberOfLines={1}>
                  {item.email}
                </Text>
                {item.restricted_features.length > 0 && (
                  <Text style={styles.rowRestricted}>
                    Restricted: {item.restricted_features.join(', ')}
                  </Text>
                )}
              </View>
              <TouchableOpacity onPress={() => remove(item)} hitSlop={8}>
                <Ionicons name="trash-outline" size={20} color={Colors.error} />
              </TouchableOpacity>
            </TouchableOpacity>
          )}
        />
      )}

      <Modal visible={showForm} animationType="slide" transparent onRequestClose={() => setShowForm(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editing ? 'Edit user' : 'New user'}</Text>
              <TouchableOpacity onPress={() => setShowForm(false)} hitSlop={8}>
                <Ionicons name="close" size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
              <Field label="Email">
                <TextInput
                  style={styles.input}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="user@company.com"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </Field>
              <Field label="Display name">
                <TextInput
                  style={styles.input}
                  value={name}
                  onChangeText={setName}
                  placeholder="Full name"
                  placeholderTextColor={Colors.textMuted}
                />
              </Field>
              <Field label={editing ? 'New password (optional)' : 'Password'}>
                <TextInput
                  style={styles.input}
                  value={password}
                  onChangeText={setPassword}
                  placeholder={editing ? 'Leave blank to keep' : 'At least 6 characters'}
                  placeholderTextColor={Colors.textMuted}
                  secureTextEntry
                  autoCapitalize="none"
                />
              </Field>
              <Field label="Mobile (optional)">
                <TextInput
                  style={styles.input}
                  value={mobile}
                  onChangeText={setMobile}
                  placeholder="+91…"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="phone-pad"
                />
              </Field>

              <TouchableOpacity
                style={[styles.saveBtn, saving && { opacity: 0.6 }]}
                onPress={save}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.saveBtnText}>{editing ? 'Save changes' : 'Create user'}</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  locked: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  lockedTitle: { fontSize: 17, fontWeight: '700', color: Colors.text },
  lockedSub: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center' },
  list: { padding: 16, gap: 10 },
  empty: { alignItems: 'center', gap: 10, paddingTop: 60 },
  emptyText: { fontSize: 14, color: Colors.textSecondary },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: Colors.primary, fontWeight: '700', fontSize: 16 },
  rowName: { fontSize: 15, fontWeight: '600', color: Colors.text },
  rowEmail: { fontSize: 13, color: Colors.textSecondary, marginTop: 1 },
  rowRestricted: { fontSize: 11, color: Colors.warning, marginTop: 3 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: Colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
    paddingTop: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  modalTitle: { fontSize: 19, fontWeight: '700', color: Colors.text },
  form: { paddingHorizontal: 20, paddingBottom: 32, gap: 14 },
  field: { gap: 6 },
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
  sectionLabel: { fontSize: 13, fontWeight: '700', color: Colors.text, marginTop: 6 },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  featureLabel: { fontSize: 15, color: Colors.text },
  hint: { fontSize: 12, color: Colors.textMuted },
  saveBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 12,
  },
  saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
