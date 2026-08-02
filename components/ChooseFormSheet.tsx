import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, FlatList, StyleSheet, BackHandler } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';

export type ChooseableForm = { id: string; title: string; url: string };

type Props = {
  visible: boolean;
  forms: ChooseableForm[];
  onPick: (form: ChooseableForm) => void;
  onClose: () => void;
};

/**
 * Shown right after logging a visit when more than one form is attached to
 * the area — pick one to open now. Dismissing (✕ / back) doesn't lose the
 * others: every attached form also gets its own "Open form" button on the
 * task list, so the user can open any of them from there at any time.
 */
export function ChooseFormSheet({ visible, forms, onPick, onClose }: Props) {
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Visit logged</Text>
              <Text style={styles.subtitle}>
                {forms.length} forms are attached to this area — choose one to open now.
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={24} color={Colors.text} />
            </TouchableOpacity>
          </View>

          <FlatList
            data={forms}
            keyExtractor={(f) => f.id}
            contentContainerStyle={{ paddingBottom: 12 }}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.row} onPress={() => onPick(item)} activeOpacity={0.7}>
                <Ionicons name="document-text-outline" size={20} color={Colors.primary} />
                <Text style={styles.rowText} numberOfLines={1}>
                  {item.title || 'Form'}
                </Text>
                <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
              </TouchableOpacity>
            )}
          />

          <Text style={styles.hint}>You can open the rest anytime from the task list.</Text>
        </View>
      </View>
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
    paddingTop: 16,
    maxHeight: '75%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 18,
    paddingBottom: 12,
  },
  title: { fontSize: 18, fontWeight: '700', color: Colors.text },
  subtitle: { fontSize: 13, color: Colors.textSecondary, marginTop: 3 },
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
  hint: {
    fontSize: 12,
    color: Colors.textMuted,
    textAlign: 'center',
    paddingVertical: 12,
    paddingHorizontal: 18,
  },
});
