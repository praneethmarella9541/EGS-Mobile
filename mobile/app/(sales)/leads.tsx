import { useCallback, useState } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity, Alert, RefreshControl } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { leadsApi } from '../../src/api';
import { colors, shared } from '../../src/styles';

const STAGES = ['prospect', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];

export default function SalesLeadsScreen() {
  const [leads, setLeads] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [phone, setPhone] = useState('');
  const [value, setValue] = useState('');

  const load = async () => {
    const { data } = await leadsApi.getAll();
    setLeads(data);
  };

  useFocusEffect(useCallback(() => { load(); }, []));

  const create = async () => {
    if (!name) return Alert.alert('Error', 'Name required');
    try {
      await leadsApi.create({ name, company, phone, value: parseFloat(value) || 0, source: 'Field Visit' });
      setShowForm(false);
      setName(''); setCompany(''); setPhone(''); setValue('');
      load();
      Alert.alert('Success', 'Lead created');
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.error || err.message);
    }
  };

  const updateStage = async (id: string, stage: string) => {
    await leadsApi.update(id, { stage });
    load();
  };

  return (
    <ScrollView style={shared.container} contentContainerStyle={shared.content} refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
      <Text style={shared.title}>My Leads</Text>
      <Text style={shared.subtitle}>Track your sales pipeline</Text>

      <TouchableOpacity style={shared.btn} onPress={() => setShowForm(!showForm)}>
        <Text style={shared.btnText}>{showForm ? 'Cancel' : '+ New Lead'}</Text>
      </TouchableOpacity>

      {showForm && (
        <View style={[shared.card, { marginTop: 12 }]}>
          <TextInput style={shared.input} placeholder="Name" placeholderTextColor={colors.muted} value={name} onChangeText={setName} />
          <TextInput style={shared.input} placeholder="Company" placeholderTextColor={colors.muted} value={company} onChangeText={setCompany} />
          <TextInput style={shared.input} placeholder="Phone" placeholderTextColor={colors.muted} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
          <TextInput style={shared.input} placeholder="Value (₹)" placeholderTextColor={colors.muted} value={value} onChangeText={setValue} keyboardType="numeric" />
          <TouchableOpacity style={shared.btn} onPress={create}>
            <Text style={shared.btnText}>Save Lead</Text>
          </TouchableOpacity>
        </View>
      )}

      {leads.map((lead) => (
        <View key={lead.id} style={shared.card}>
          <Text style={shared.cardTitle}>{lead.name}</Text>
          <Text style={shared.cardSub}>{lead.company} • ₹{lead.value?.toLocaleString()}</Text>
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
