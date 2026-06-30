import { useCallback, useState } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity, Alert, RefreshControl } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { salesApi } from '../../src/api';
import { colors, shared } from '../../src/styles';

export default function SalesFormsScreen() {
  const [forms, setForms] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const load = async () => {
    const { data } = await salesApi.getForms();
    setForms(data);
  };

  useFocusEffect(useCallback(() => { load(); }, []));

  const submit = async () => {
    if (!selected) return;
    const missing = selected.fields.filter((f: any) => f.required && !answers[f.id]);
    if (missing.length) return Alert.alert('Error', `Please fill: ${missing.map((f: any) => f.label).join(', ')}`);

    try {
      await salesApi.submitForm(selected.id, answers);
      Alert.alert('Success', 'Form submitted');
      setSelected(null);
      setAnswers({});
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.error || err.message);
    }
  };

  if (selected) {
    return (
      <ScrollView style={shared.container} contentContainerStyle={shared.content} keyboardShouldPersistTaps="handled">
        <TouchableOpacity onPress={() => setSelected(null)}>
          <Text style={{ color: colors.primary, marginBottom: 16 }}>← Back</Text>
        </TouchableOpacity>
        <Text style={shared.title}>{selected.title}</Text>
        <Text style={shared.subtitle}>{selected.description}</Text>
        {selected.fields.map((field: any) => (
          <View key={field.id}>
            <Text style={shared.label}>{field.label}{field.required ? ' *' : ''}</Text>
            <TextInput
              style={[shared.input, field.type === 'textarea' && { height: 80 }]}
              multiline={field.type === 'textarea'}
              placeholderTextColor={colors.muted}
              value={answers[field.id] || ''}
              onChangeText={(t) => setAnswers({ ...answers, [field.id]: t })}
            />
          </View>
        ))}
        <TouchableOpacity style={shared.btn} onPress={submit}>
          <Text style={shared.btnText}>Submit Form</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={shared.container} contentContainerStyle={shared.content} refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
      <Text style={shared.title}>Forms</Text>
      <Text style={shared.subtitle}>Fill forms assigned by admin</Text>
      {forms.map((form) => (
        <TouchableOpacity key={form.id} style={shared.card} onPress={() => { setSelected(form); setAnswers({}); }}>
          <Text style={shared.cardTitle}>{form.title}</Text>
          <Text style={shared.cardSub}>{form.description}</Text>
          <Text style={{ color: colors.primary, marginTop: 8 }}>Fill Form →</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}
