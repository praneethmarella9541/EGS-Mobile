import { useCallback, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { adminApi } from '../../src/api';
import { colors, shared } from '../../src/styles';

const STAGE_COLORS: Record<string, string> = {
  prospect: '#64748b',
  qualified: '#3b82f6',
  proposal: '#8b5cf6',
  negotiation: '#f59e0b',
  won: '#22c55e',
  lost: '#ef4444',
};

export default function DashboardScreen() {
  const [data, setData] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    const { data: d } = await adminApi.getDashboard();
    setData(d);
  };

  useFocusEffect(useCallback(() => { load(); }, []));

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (!data) {
    return <View style={shared.container}><Text style={{ color: colors.muted, padding: 20 }}>Loading...</Text></View>;
  }

  const { summary, funnel, recentLeads, salesPerformance } = data;

  return (
    <ScrollView style={shared.container} contentContainerStyle={shared.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}>
      <Text style={shared.title}>Admin Dashboard</Text>
      <Text style={shared.subtitle}>Sales funnel & attendance overview</Text>

      <View style={styles.grid}>
        <MetricCard label="Sales Team" value={summary.totalSalesPeople} />
        <MetricCard label="Today's Check-ins" value={summary.todayAttendance} />
        <MetricCard label="Total Leads" value={summary.totalLeads} />
        <MetricCard label="Conversion Rate" value={`${summary.conversionRate}%`} />
        <MetricCard label="Won Revenue" value={`₹${(summary.wonRevenue / 1000).toFixed(0)}K`} />
        <MetricCard label="Pipeline Value" value={`₹${(summary.pipelineValue / 1000).toFixed(0)}K`} />
        <MetricCard label="Failed GPS Checks" value={summary.failedFollowUps} color={colors.danger} />
        <MetricCard label="Form Submissions" value={summary.formSubmissions} />
      </View>

      <Text style={styles.section}>Sales Funnel</Text>
      {funnel.map((stage: any) => (
        <View key={stage.stage} style={shared.card}>
          <View style={shared.row}>
            <View style={[styles.badge, { backgroundColor: STAGE_COLORS[stage.stage] + '33' }]}>
              <Text style={{ color: STAGE_COLORS[stage.stage], fontWeight: '600', textTransform: 'capitalize' }}>{stage.stage}</Text>
            </View>
            <Text style={{ color: colors.text, fontWeight: '700' }}>{stage.count} leads</Text>
          </View>
          <Text style={shared.cardSub}>Value: ₹{stage.total_value?.toLocaleString()}</Text>
          <View style={styles.barBg}>
            <View style={[styles.barFill, { width: `${Math.min(100, (stage.count / Math.max(summary.totalLeads, 1)) * 100)}%`, backgroundColor: STAGE_COLORS[stage.stage] }]} />
          </View>
        </View>
      ))}

      <Text style={styles.section}>Team Performance</Text>
      {salesPerformance.map((s: any) => (
        <View key={s.id} style={shared.card}>
          <Text style={shared.cardTitle}>{s.name}</Text>
          <Text style={shared.cardSub}>Today: {s.today_checkins} check-ins | Won: {s.won_deals} | Leads: {s.total_leads}</Text>
        </View>
      ))}

      <Text style={styles.section}>Recent Leads</Text>
      {recentLeads.map((lead: any) => (
        <View key={lead.id} style={shared.card}>
          <View style={shared.row}>
            <Text style={shared.cardTitle}>{lead.name}</Text>
            <Text style={{ color: STAGE_COLORS[lead.stage], textTransform: 'capitalize', fontSize: 12 }}>{lead.stage}</Text>
          </View>
          <Text style={shared.cardSub}>{lead.company} • ₹{lead.value?.toLocaleString()} • {lead.assigned_to_name || 'Unassigned'}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

function MetricCard({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  metric: { width: '47%', backgroundColor: colors.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: colors.border },
  metricValue: { fontSize: 22, fontWeight: '700', color: colors.text },
  metricLabel: { fontSize: 11, color: colors.muted, marginTop: 4 },
  section: { fontSize: 18, fontWeight: '600', color: colors.text, marginBottom: 12, marginTop: 8 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  barBg: { height: 6, backgroundColor: colors.border, borderRadius: 3, marginTop: 10, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 3 },
});
