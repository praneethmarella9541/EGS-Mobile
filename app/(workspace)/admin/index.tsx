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
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FormSheet } from '../../../components/FormSheet';
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
  const [showPassword, setShowPassword] = useState(false);
  const [mobile, setMobile] = useState('');
  const [blockTarget, setBlockTarget] = useState<TeamMember | null>(null);
  const [blockBusy, setBlockBusy] = useState(false);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);

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
    setShowPassword(false);
    setMobile('');
    setShowForm(true);
  }

  function openEdit(m: TeamMember) {
    setEditing(m);
    setEmail(m.email);
    setName(m.display_name ?? '');
    setPassword('');
    setShowPassword(false);
    setMobile(m.mobile_phone ?? '');
    setShowForm(true);
  }

  async function save() {
    // Editing an existing user is password-only (that's all the edit form exposes).
    if (editing) {
      if (!password) return Alert.alert('Error', 'Enter a new password.');
      setSaving(true);
      try {
        await adminUsers.update({ id: editing.id, password });
        setShowForm(false);
        await load();
      } catch (e: any) {
        Alert.alert('Error', e?.message ?? 'Could not update password');
      } finally {
        setSaving(false);
      }
      return;
    }

    if (!email.trim()) return Alert.alert('Error', 'Email is required.');
    if (!password) return Alert.alert('Error', 'Password is required for new users.');
    setSaving(true);
    try {
      await adminUsers.create({
        email: email.trim().toLowerCase(),
        password,
        display_name: name.trim() || null,
        mobile_phone: mobile.trim() || null,
      });
      setShowForm(false);
      await load();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function confirmBlock() {
    if (!blockTarget) return;
    setBlockBusy(true);
    try {
      await adminUsers.block(blockTarget.id);
      setBlockTarget(null);
      await load();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not block user');
    } finally {
      setBlockBusy(false);
    }
  }

  async function unblock(m: TeamMember) {
    setUnblockingId(m.id);
    try {
      await adminUsers.unblock(m.id);
      await load();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not unblock user');
    } finally {
      setUnblockingId(null);
    }
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
            <View style={[styles.row, item.blocked && styles.rowBlocked]}>
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
                {item.blocked && (
                  <View style={styles.blockedBadge}>
                    <Ionicons name="ban" size={12} color={Colors.error} />
                    <Text style={styles.blockedBadgeText}>Access blocked</Text>
                  </View>
                )}
                {item.restricted_features.length > 0 && (
                  <Text style={styles.rowRestricted}>
                    Restricted: {item.restricted_features.join(', ')}
                  </Text>
                )}
              </View>
              <TouchableOpacity
                onPress={() => openEdit(item)}
                hitSlop={8}
                style={styles.rowAction}
                accessibilityLabel="Reset password"
              >
                <Ionicons name="create-outline" size={20} color={Colors.primary} />
              </TouchableOpacity>
              {item.blocked ? (
                <TouchableOpacity
                  onPress={() => unblock(item)}
                  hitSlop={8}
                  style={styles.rowAction}
                  disabled={unblockingId === item.id}
                  accessibilityLabel="Restore access"
                >
                  {unblockingId === item.id ? (
                    <ActivityIndicator size="small" color={Colors.success} />
                  ) : (
                    <Ionicons name="shield-checkmark-outline" size={20} color={Colors.success} />
                  )}
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  onPress={() => setBlockTarget(item)}
                  hitSlop={8}
                  style={styles.rowAction}
                  accessibilityLabel="Block access"
                >
                  <Ionicons name="ban-outline" size={20} color={Colors.error} />
                </TouchableOpacity>
              )}
            </View>
          )}
        />
      )}

      <FormSheet visible={showForm} onRequestClose={() => setShowForm(false)}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editing ? 'Reset password' : 'New user'}</Text>
              <TouchableOpacity onPress={() => setShowForm(false)} hitSlop={8}>
                <Ionicons name="close" size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
              {editing ? (
                // Editing an existing user: only the password is editable. Email
                // and name are shown read-only for context.
                <View style={styles.readonlyBox}>
                  <Text style={styles.readonlyName} numberOfLines={1}>
                    {editing.display_name || editing.email.split('@')[0]}
                  </Text>
                  <Text style={styles.readonlyEmail} numberOfLines={1}>
                    {editing.email}
                  </Text>
                </View>
              ) : (
                <>
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
                </>
              )}
              <Field label={editing ? 'New password' : 'Password'}>
                <View style={styles.passwordWrap}>
                  <TextInput
                    style={styles.passwordInput}
                    value={password}
                    onChangeText={setPassword}
                    placeholder="At least 6 characters"
                    placeholderTextColor={Colors.textMuted}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                  />
                  <TouchableOpacity
                    onPress={() => setShowPassword((v) => !v)}
                    hitSlop={8}
                    style={styles.eyeBtn}
                    accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                  >
                    <Ionicons
                      name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                      size={20}
                      color={Colors.textMuted}
                    />
                  </TouchableOpacity>
                </View>
              </Field>
              {!editing && (
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
              )}

              <TouchableOpacity
                style={[styles.saveBtn, saving && { opacity: 0.6 }]}
                onPress={save}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.saveBtnText}>
                    {editing ? 'Update password' : 'Create user'}
                  </Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
      </FormSheet>

      {/* Blocking revokes sign-in without touching any data — profile, assignments,
          attendance and photos all stay exactly as they are and remain visible to
          admins. Reversible via "Restore access", unlike the old permanent delete. */}
      <Modal
        visible={!!blockTarget}
        animationType="fade"
        transparent
        onRequestClose={() => !blockBusy && setBlockTarget(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Block access</Text>
              <TouchableOpacity onPress={() => !blockBusy && setBlockTarget(null)} hitSlop={8}>
                <Ionicons name="close" size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>
            <View style={styles.form}>
              <Text style={styles.deleteName} numberOfLines={1}>
                {blockTarget?.display_name || blockTarget?.email}
              </Text>
              <View style={styles.warnBox}>
                <Ionicons name="warning-outline" size={20} color={Colors.error} />
                <Text style={styles.warnText}>
                  They won't be able to sign in to the mobile app with this account anymore. All of
                  their data — assignments, attendance and photos — stays exactly as it is and
                  remains visible here. You can restore access anytime.
                </Text>
              </View>
              <View style={styles.deleteBtnRow}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => setBlockTarget(null)}
                  disabled={blockBusy}
                >
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.deleteBtn, blockBusy && { opacity: 0.6 }]}
                  onPress={confirmBlock}
                  disabled={blockBusy}
                >
                  {blockBusy ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.deleteBtnText}>Block access</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
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
  list: { padding: 16, paddingBottom: 40, gap: 10 },
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
  rowBlocked: { opacity: 0.6 },
  blockedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  blockedBadgeText: { fontSize: 11, fontWeight: '700', color: Colors.error },
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
  passwordWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    paddingRight: 8,
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.text,
  },
  eyeBtn: { padding: 6 },
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
  rowAction: { padding: 6, marginLeft: 4 },
  readonlyBox: {
    backgroundColor: Colors.primaryLight,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  readonlyName: { fontSize: 15, fontWeight: '700', color: Colors.text },
  readonlyEmail: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  deleteName: { fontSize: 16, fontWeight: '700', color: Colors.text },
  warnBox: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    backgroundColor: 'rgba(217,48,37,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(217,48,37,0.35)',
    borderRadius: 10,
    padding: 12,
  },
  warnText: { flex: 1, fontSize: 13, lineHeight: 19, color: Colors.error, fontWeight: '500' },
  deleteBtnRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  cancelBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cancelBtnText: { color: Colors.text, fontSize: 15, fontWeight: '600' },
  deleteBtn: {
    flex: 1,
    backgroundColor: Colors.error,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  deleteBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
