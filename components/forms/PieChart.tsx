import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { FormsTheme } from '../../constants/formsTheme';
import type { ChoiceBucket } from '../../lib/form-responses';

/** Same slice palette Google Forms cycles through in its response charts. */
const SLICE_COLORS = [
  '#673AB7', '#FF6D01', '#4285F4', '#0F9D58', '#F4B400',
  '#DB4437', '#00ACC1', '#8E24AA', '#5C6BC0', '#26A69A',
];

const SIZE = 160;
const RADIUS = SIZE / 2;

function polarToCartesian(angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: RADIUS + RADIUS * Math.cos(rad), y: RADIUS + RADIUS * Math.sin(rad) };
}

function sliceLabel(count: number, total: number) {
  return total > 0 ? `${Math.round((count / total) * 100)}%` : '0%';
}

/** Pie chart summary for single-choice questions, matching Google Forms' response view. */
export function PieChart({ buckets, total }: { buckets: ChoiceBucket[]; total: number }) {
  let cursor = 0;
  const slices = buckets
    .filter((b) => b.count > 0)
    .map((b, i) => {
      const fraction = total > 0 ? b.count / total : 0;
      const startAngle = cursor * 360;
      cursor += fraction;
      const endAngle = cursor * 360;
      const color = SLICE_COLORS[i % SLICE_COLORS.length];

      if (fraction >= 0.9999) {
        // A full circle can't be drawn as a single arc path — use a circle instead.
        return { key: b.label, color, full: true };
      }
      const start = polarToCartesian(startAngle);
      const end = polarToCartesian(endAngle);
      const largeArc = endAngle - startAngle > 180 ? 1 : 0;
      const d = `M ${RADIUS} ${RADIUS} L ${start.x} ${start.y} A ${RADIUS} ${RADIUS} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
      return { key: b.label, color, d, full: false };
    });

  return (
    <View style={styles.row}>
      <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        {slices.map((s) =>
          s.full ? (
            <Circle key={s.key} cx={RADIUS} cy={RADIUS} r={RADIUS} fill={s.color} />
          ) : (
            <Path key={s.key} d={s.d} fill={s.color} />
          )
        )}
      </Svg>
      <View style={styles.legend}>
        {buckets.map((b, i) => (
          <View key={b.label} style={styles.legendRow}>
            <View style={[styles.dot, { backgroundColor: SLICE_COLORS[i % SLICE_COLORS.length] }]} />
            <Text style={styles.legendLabel} numberOfLines={1}>{b.label}</Text>
            <Text style={styles.legendPct}>{sliceLabel(b.count, total)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  legend: { flex: 1, gap: 6, minWidth: 0 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  legendLabel: { flex: 1, fontSize: 12, color: FormsTheme.text },
  legendPct: { fontSize: 11, fontWeight: '600', color: FormsTheme.textSecondary },
});
