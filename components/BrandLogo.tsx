import React from 'react';
import { View, Text, StyleSheet, type ViewStyle } from 'react-native';
import { APP_NAME } from '../constants/branding';
import { Theme } from '../constants/theme';
import { LogoMark } from './LogoMark';

type Size = 'sm' | 'md' | 'lg';

const SIZES: Record<Size, { badge: number; mark: number; font: number }> = {
  sm: { badge: 28, mark: 20, font: 16 },
  md: { badge: 52, mark: 36, font: 22 },
  lg: { badge: 76, mark: 54, font: 28 },
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
        <LogoMark size={dims.mark} color="#FFFFFF" />
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
  name: { fontWeight: '700', letterSpacing: 0.2 },
});
