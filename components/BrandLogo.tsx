import React from 'react';
import { View, Text, StyleSheet, type ViewStyle } from 'react-native';
import { APP_NAME, APP_MONOGRAM } from '../constants/branding';
import { Theme } from '../constants/theme';

type Size = 'sm' | 'md' | 'lg';

const SIZES: Record<Size, { badge: number; mono: number; font: number }> = {
  sm: { badge: 28, mono: 11, font: 16 },
  md: { badge: 52, mono: 18, font: 22 },
  lg: { badge: 76, mono: 26, font: 28 },
};

type Props = {
  size?: Size;
  layout?: 'row' | 'column';
  showName?: boolean;
  nameColor?: string;
  style?: ViewStyle;
};

export function BrandLogo({
  size = 'md',
  layout = 'row',
  showName = true,
  nameColor = '#FFFFFF',
  style,
}: Props) {
  const dims = SIZES[size];
  return (
    <View style={[styles.row, layout === 'column' && styles.column, style]}>
      <View
        style={[
          styles.badge,
          { width: dims.badge, height: dims.badge, borderRadius: size === 'sm' ? 7 : 14 },
        ]}
        accessibilityLabel={`${APP_NAME} logo`}
      >
        <Text style={[styles.mono, { fontSize: dims.mono }]}>{APP_MONOGRAM}</Text>
      </View>
      {showName ? (
        <Text style={[styles.name, { fontSize: dims.font, color: nameColor }]} numberOfLines={1}>
          {APP_NAME}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  column: { flexDirection: 'column', gap: 12 },
  badge: {
    backgroundColor: Theme.copper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mono: { color: '#FFFFFF', fontWeight: '800', letterSpacing: 0.5 },
  name: { fontWeight: '700', letterSpacing: 0.2 },
});
