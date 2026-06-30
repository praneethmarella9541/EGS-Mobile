import { useCallback, useState } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity, Alert, RefreshControl } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { adminApi, leadsApi } from '../../src/api';
import { colors, shared } from '../../src/styles';

const STAGES = ['prospect', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];

const emptyForm = {
  name: '',
  company: '',
  email: '',
  phone: '',
  value: '',
  notes: '',
  stage: 'prospect',
  assigned_to: '',
};

export default function LeadsScreen() {
  const [leads, setLeads] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  const load = async () => {
    const [leadsRes, usersRes] = await Promise.all([leadsApi.getAll(), adminApi.getUsers()]);
    setLeads(leadsRes.data);
    setUsers(usersRes.data);
  };

  useFocusEffect(useCallback(() => { load(); }, []));

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(false);
  };

  const openCreate = () => {
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(true);
  };

  const openEdit = (lead: any) => {
    setEditingId(lead.id);
    setForm({
      name: lead.name || '',
      company: lead.company || '',
      email: lead.email || '',
      phone: lead.phone || '',
      value: String(lead.value ?? ''),
      notes: lead.notes || '',
      stage: lead.stage || 'prospect',
      assigned_to: lead.assigned_to || '',
    });
    setShowForm(true);
  };

  const save = async () => {
    if (!form.name.trim()) return Alert.alert('Error', 'Name required');
    const payload = {
      name: form.name.trim(),
      company: form.company.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      value: parseFloat(form.value) || 0,
      notes: form.notes.trim() || null,
      stage: form.stage,
      assigned_to: form.assigned_to || null,
    };

    try {
      if (editingId) {
        await leadsApi.update(editingId, payload);
        Alert.alert('Success', 'Lead updated');
      } else {
        await leadsApi.create(payload);
        Alert.alert('Success', 'Lead created');
      }
      resetForm();
      load();
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.error || err.message);
    }
  };

  const updateStage = async (id: string, newStage: string) => {
    await leadsApi.update(id, { stage: newStage });
    load();
  };

  const confirmDelete = (lead: any) => {
    Alert.alert('Delete Lead', `Remove "${lead.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await leadsApi.delete(lead.id);
            load();
          } catch (err: any) {
            Alert.alert('Error', err.response?.data?.error || err.message);
          }
        },
      },
    ]);
  };

  const setField = (key: keyof typeof form, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <ScrollView
      style={shared.container}
      contentContainerStyle={shared.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}
    >
      <Text style={shared.title}>Leads</Text>
      <Text style={shared.subtitle}>Manage sales pipeline</Text>

      <TouchableOpacity style={shared.btn} onPress={() => (showForm ? resetForm() : openCreate())}>
        <Text style={shared.btnText}>{showForm ? 'Cancel' : '+ Add Lead'}</Text>
      </TouchableOpacity>

      {showForm && (
        <View style={[shared.card, { marginTop: 12 }]}>
          <Text style={shared.cardTitle}>{editingId ? 'Edit Lead' : 'New Lead'}</Text>
          <TextInput style={shared.input} placeholder="Lead Name *" placeholderTextColor={colors.muted} value={form.name} onChangeText={(v) => setField('name', v)} />
          <TextInput style={shared.input} placeholder="Company" placeholderTextColor={colors.muted} value={form.company} onChangeText={(v) => setField('company', v)} />
          <TextInput style={shared.input} placeholder="Email" placeholderTextColor={colors.muted} value={form.email} onChangeText={(v) => setField('email', v)} keyboardType="email-address" autoCapitalize="none" />
          <TextInput style={shared.input} placeholder="Phone" placeholderTextColor={colors.muted} value={form.phone} onChangeText={(v) => setField('phone', v)} keyboardType="phone-pad" />
          <TextInput style={shared.input} placeholder="Value (₹)" placeholderTextColor={colors.muted} value={form.value} onChangeText={(v) => setField('value', v)} keyboardType="numeric" />
          <TextInput style={[shared.input, { height: 80 }]} placeholder="Notes" placeholderTextColor={colors.muted} value={form.notes} onChangeText={(v) => setField('notes', v)} multiline />
          <Text style={shared.label}>Stage</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
            {STAGES.map((s) => (
              <TouchableOpacity key={s} style={[shared.badge, { marginRight: 8, backgroundColor: form.stage === s ? colors.primary : colors.border }]} onPress={() => setField('stage', s)}>
                <Text style={{ color: colors.text, textTransform: 'capitalize', fontSize: 12 }}>{s}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <Text style={shared.label}>Assign to</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
            <TouchableOpacity style={[shared.badge, { marginRight: 8, backgroundColor: !form.assigned_to ? colors.primary : colors.border }]} onPress={() => setField('assigned_to', '')}>
              <Text style={{ color: colors.text, fontSize: 12 }}>Unassigned</Text>
            </TouchableOpacity>
            {users.map((u) => (
              <TouchableOpacity key={u.id} style={[shared.badge, { marginRight: 8, backgroundColor: form.assigned_to === u.id ? colors.primary : colors.border }]} onPress={() => setField('assigned_to', u.id)}>
                <Text style={{ color: colors.text, fontSize: 12 }}>{u.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TouchableOpacity style={shared.btn} onPress={save}>
            <Text style={shared.btnText}>{editingId ? 'Update Lead' : 'Save Lead'}</Text>
          </TouchableOpacity>
        </View>
      )}

      {leads.map((lead) => (
        <View key={lead.id} style={shared.card}>
          <View style={shared.row}>
            <Text style={shared.cardTitle}>{lead.name}</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity onPress={() => openEdit(lead)}>
                <Text style={{ color: colors.primary, fontWeight: '600' }}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => confirmDelete(lead)}>
                <Text style={{ color: colors.danger, fontWeight: '600' }}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
          <Text style={shared.cardSub}>{lead.company} • ₹{lead.value?.toLocaleString()}</Text>
          {lead.email ? <Text style={shared.cardSub}>{lead.email}</Text> : null}
          {lead.phone ? <Text style={shared.cardSub}>{lead.phone}</Text> : null}
          {lead.notes ? <Text style={shared.cardSub}>Notes: {lead.notes}</Text> : null}
          <Text style={shared.cardSub}>Assigned: {lead.assigned_to_name || 'Unassigned'}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
            {STAGES.map((s) => (
              <TouchableOpacity key={s} style={[shared.badge, { marginRight: 6, backgroundColor: lead.stage === s ? colors.primary : colors.border }]} onPress={() => updateStage(lead.id, s)}>
                <Text style={{ color: colors.text, textTransform: 'capitalize', fontSize: 11 }}>{s}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      ))}
    </ScrollView>
  );
}
