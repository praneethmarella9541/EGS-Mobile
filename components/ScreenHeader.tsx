import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { useDrawer } from '../app/(workspace)/_layout';

type Props = {
  title: string;
  right?: React.ReactNode;
};

export function ScreenHeader({ title, right }: Props) {
  const insets = useSafeAreaInsets();
  const { openDrawer } = useDrawer();

  return (
    <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
      <TouchableOpacity onPress={openDrawer} hitSlop={10} style={styles.menuBtn} accessibilityLabel="Open menu">
        <Ionicons name="menu" size={26} color={Colors.text} />
      </TouchableOpacity>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      <View style={styles.right}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: Colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  menuBtn: { padding: 2 },
  title: { flex: 1, fontSize: 20, fontWeight: '700', color: Colors.text, letterSpacing: -0.3 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
