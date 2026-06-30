import { useCallback, useState } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity, Alert, RefreshControl } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { adminApi } from '../../src/api';
import { colors, shared } from '../../src/styles';

type FormField = { key: string; label: string; type: string; required: boolean };

function slugify(text: string, fallback: string) {
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return slug || fallback;
}

export default function FormsScreen() {
  const [forms, setForms] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [fields, setFields] = useState<FormField[]>([
    { key: 'field_1', label: '', type: 'text', required: true },
  ]);

  const load = async () => {
    const { data } = await adminApi.getForms();
    setForms(data);
  };

  useFocusEffect(useCallback(() => { load(); }, []));

  const addField = () => {
    setFields((prev) => [
      ...prev,
      { key: `field_${Date.now()}_${prev.length}`, label: '', type: 'text', required: false },
    ]);
  };

  const updateFieldLabel = (index: number, label: string) => {
    setFields((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], label };
      return updated;
    });
  };

  const create = async () => {
    if (!title.trim()) return Alert.alert('Error', 'Title required');
    const preparedFields = fields
      .filter((f) => f.label.trim())
      .map((f, i) => ({
        id: slugify(f.label, f.key),
        label: f.label.trim(),
        type: f.type,
        required: f.required,
      }));

    if (!preparedFields.length) return Alert.alert('Error', 'Add at least one field with a label');

    try {
      await adminApi.createForm({ title: title.trim(), description: description.trim(), fields: preparedFields });
      setShowForm(false);
      setTitle('');
      setDescription('');
      setFields([{ key: 'field_1', label: '', type: 'text', required: true }]);
      load();
      Alert.alert('Success', 'Form created');
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.error || err.message);
    }
  };

  return (
    <ScrollView
      style={shared.container}
      contentContainerStyle={shared.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}
    >
      <Text style={shared.title}>Forms</Text>
      <Text style={shared.subtitle}>Create forms for sales people to fill</Text>

      <TouchableOpacity style={shared.btn} onPress={() => setShowForm(!showForm)}>
        <Text style={shared.btnText}>{showForm ? 'Cancel' : '+ Create Form'}</Text>
      </TouchableOpacity>

      {showForm && (
        <View style={[shared.card, { marginTop: 12 }]}>
          <TextInput
            style={shared.input}
            placeholder="Form Title"
            placeholderTextColor={colors.muted}
            value={title}
            onChangeText={setTitle}
          />
          <TextInput
            style={shared.input}
            placeholder="Description"
            placeholderTextColor={colors.muted}
            value={description}
            onChangeText={setDescription}
          />
          <Text style={[shared.cardTitle, { marginBottom: 8 }]}>Fields</Text>
          {fields.map((f, i) => (
            <TextInput
              key={f.key}
              style={shared.input}
              placeholder={`Field ${i + 1} label`}
              placeholderTextColor={colors.muted}
              value={f.label}
              onChangeText={(t) => updateFieldLabel(i, t)}
            />
          ))}
          <TouchableOpacity style={shared.btnOutline} onPress={addField}>
            <Text style={{ color: colors.primary }}>+ Add Field</Text>
          </TouchableOpacity>
          <TouchableOpacity style={shared.btn} onPress={create}>
            <Text style={shared.btnText}>Save Form</Text>
          </TouchableOpacity>
        </View>
      )}

      {forms.map((form) => (
        <View key={form.id} style={shared.card}>
          <Text style={shared.cardTitle}>{form.title}</Text>
          <Text style={shared.cardSub}>{form.description}</Text>
          <Text style={shared.cardSub}>{form.fields?.length} fields • {form.submission_count} submissions</Text>
        </View>
      ))}
    </ScrollView>
  );
}
