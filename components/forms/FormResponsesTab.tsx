import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { FormsTheme } from '../../constants/formsTheme';
import { formsApi } from '../../lib/forms-api';
import {
  buildQuestionTitleMap,
  formatAnswer,
  responsesToCsv,
  summarizeResponses,
  type FormResponse,
} from '../../lib/form-responses';
import type { EditorBlock } from '../../lib/google-forms-editor-model';
import { exportResponsesCsv } from '../../lib/forms-actions';
import { FormLinkedSheetPreview } from './FormLinkedSheetPreview';
import { PieChart } from './PieChart';

type Props = {
  formId: string;
  editorBlocks: EditorBlock[];
  linkedSheetId: string | null;
  formTitle: string;
  isQuiz: boolean;
};

function SummaryBar({ label, count, max }: { label: string; count: number; max: number }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <View style={styles.barWrap}>
      <View style={styles.barHeader}>
        <Text style={styles.barLabel} numberOfLines={1}>{label}</Text>
        <Text style={styles.barCount}>{count} ({pct}%)</Text>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${pct}%` }]} />
      </View>
    </View>
  );
}

export function FormResponsesTab({ formId, editorBlocks, linkedSheetId, formTitle, isQuiz }: Props) {
  const [responses, setResponses] = useState<FormResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [view, setView] = useState<'summary' | 'individual' | 'spreadsheet'>('summary');

  const load = useCallback(
    async (append = false, pageToken?: string) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const data = await formsApi.responses(formId, { pageToken, pageSize: 50 });
        const batch = data.responses ?? [];
        setResponses((prev) => (append ? [...prev, ...batch] : batch));
        setNextPageToken(data.nextPageToken);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Failed to load responses');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [formId]
  );

  useEffect(() => {
    void load();
  }, [load]);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  }

  const summaries = summarizeResponses(responses, editorBlocks);
  const questionTitles = buildQuestionTitleMap(editorBlocks);
  const maxBucket = (buckets: { count: number }[]) => Math.max(1, ...buckets.map((b) => b.count));

  async function handleExportCsv() {
    const safeName = (formTitle.trim() || 'form').replace(/[^\w-]+/g, '_').slice(0, 40);
    await exportResponsesCsv(`${safeName}-responses.csv`, responsesToCsv(responses, editorBlocks));
  }

  if (loading && responses.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={FormsTheme.purple} />
        <Text style={styles.muted}>Loading responses…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.errorBox}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={() => load()}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.toolbar}>
        <View style={styles.viewToggle}>
          {(['summary', 'individual', ...(linkedSheetId ? (['spreadsheet'] as const) : [])] as const).map(
            (v) => (
              <TouchableOpacity
                key={v}
                style={[styles.viewBtn, view === v && styles.viewBtnActive]}
                onPress={() => setView(v)}
              >
                <Text style={[styles.viewBtnText, view === v && styles.viewBtnTextActive]}>
                  {v === 'summary' ? 'Summary' : v === 'individual' ? 'Individual' : 'Spreadsheet'}
                </Text>
              </TouchableOpacity>
            )
          )}
        </View>
        <View style={styles.toolbarActions}>
          {responses.length > 0 ? (
            <TouchableOpacity style={styles.actionBtn} onPress={() => void handleExportCsv()}>
              <Ionicons name="download-outline" size={14} color={FormsTheme.purple} />
              <Text style={styles.actionBtnText}>CSV</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {view === 'spreadsheet' && linkedSheetId ? (
        <FormLinkedSheetPreview sheetId={linkedSheetId} formTitle={formTitle} />
      ) : responses.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.muted}>No responses yet.</Text>
        </View>
      ) : (
        <>
          <Text style={styles.countLine}>
            {responses.length} {responses.length === 1 ? 'response' : 'responses'}
            {nextPageToken ? ' · load more for full export' : ''}
          </Text>

          {view === 'summary' ? (
            <View style={styles.summaryList}>
              {summaries.length === 0 ? (
                <Text style={styles.muted}>No question data to summarize.</Text>
              ) : (
                summaries.map((s) => (
                  <View key={s.questionId} style={styles.summaryCard}>
                    <Text style={styles.summaryTitle}>{s.title}</Text>
                    {s.type === 'choice' && s.variant === 'single' ? (
                      <PieChart buckets={s.buckets} total={s.total} />
                    ) : s.type === 'choice' || s.type === 'scale' ? (
                      <View style={styles.barList}>
                        {s.type === 'scale' && s.average != null ? (
                          <Text style={styles.avgText}>Average: {s.average}</Text>
                        ) : null}
                        {s.buckets.map((b) => (
                          <SummaryBar key={b.label} label={b.label} count={b.count} max={maxBucket(s.buckets)} />
                        ))}
                      </View>
                    ) : (
                      <View style={styles.sampleList}>
                        {s.samples.length === 0 ? (
                          <Text style={styles.muted}>No text answers</Text>
                        ) : (
                          s.samples.slice(0, 50).map((sample, i) => (
                            <Text key={i} style={styles.sampleLine} numberOfLines={3}>
                              {sample}
                            </Text>
                          ))
                        )}
                        {s.samples.length > 50 ? (
                          <Text style={styles.moreText}>+{s.samples.length - 50} more</Text>
                        ) : null}
                      </View>
                    )}
                    <Text style={styles.totalText}>{s.total} responses</Text>
                  </View>
                ))
              )}
            </View>
          ) : (
            <View style={styles.individualList}>
              {responses.map((resp, idx) => {
                const isExpanded = expanded.has(resp.responseId);
                const answerEntries = Object.entries(resp.answers ?? {});
                const when = resp.lastSubmittedTime || resp.createTime;
                return (
                  <View key={resp.responseId} style={styles.responseCard}>
                    <TouchableOpacity
                      style={styles.responseHeader}
                      onPress={() => toggleExpand(resp.responseId)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.responseBadge}>
                        <Text style={styles.responseBadgeText}>{idx + 1}</Text>
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.responseWhen}>
                          {when ? format(new Date(when), 'MMM d, yyyy h:mm a') : `Response ${idx + 1}`}
                        </Text>
                        {resp.respondentEmail ? (
                          <Text style={styles.responseEmail} numberOfLines={1}>{resp.respondentEmail}</Text>
                        ) : null}
                        {isQuiz && resp.totalScore != null ? (
                          <Text style={styles.responseScore}>Score: {resp.totalScore}</Text>
                        ) : null}
                      </View>
                      <Ionicons
                        name={isExpanded ? 'chevron-up' : 'chevron-down'}
                        size={18}
                        color={FormsTheme.textMuted}
                      />
                    </TouchableOpacity>
                    {isExpanded ? (
                      <View style={styles.answerList}>
                        {answerEntries.length === 0 ? (
                          <Text style={styles.muted}>No answers recorded</Text>
                        ) : (
                          answerEntries.map(([qId, ans]) => (
                            <View key={qId} style={styles.answerRow}>
                              <Text style={styles.answerQ}>{questionTitles.get(qId) || qId}</Text>
                              <Text style={styles.answerA}>{formatAnswer(ans)}</Text>
                            </View>
                          ))
                        )}
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          )}

          {nextPageToken ? (
            <TouchableOpacity
              style={styles.loadMoreBtn}
              onPress={() => load(true, nextPageToken)}
              disabled={loadingMore}
            >
              {loadingMore ? (
                <ActivityIndicator size="small" color={FormsTheme.purple} />
              ) : (
                <Text style={styles.loadMoreText}>Load more responses</Text>
              )}
            </TouchableOpacity>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  center: { alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 },
  muted: { fontSize: 13, color: FormsTheme.textSecondary, textAlign: 'center' },
  errorBox: {
    padding: 14,
    backgroundColor: '#FEF2F2',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FECACA',
    gap: 8,
  },
  errorText: { fontSize: 13, color: '#B91C1C' },
  retryBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: FormsTheme.purple,
    borderRadius: 16,
  },
  retryText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  viewToggle: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: FormsTheme.border,
    borderRadius: 8,
    overflow: 'hidden',
  },
  viewBtn: { paddingHorizontal: 12, paddingVertical: 8 },
  viewBtnActive: { backgroundColor: FormsTheme.purpleLight },
  viewBtnText: { fontSize: 12, fontWeight: '600', color: FormsTheme.textSecondary },
  viewBtnTextActive: { color: FormsTheme.purple },
  toolbarActions: { flexDirection: 'row', gap: 8 },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: FormsTheme.border,
    borderRadius: 8,
    backgroundColor: FormsTheme.surface,
  },
  actionBtnText: { fontSize: 12, fontWeight: '600', color: FormsTheme.purple },
  emptyBox: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: FormsTheme.border,
    borderRadius: 8,
    padding: 32,
    alignItems: 'center',
    backgroundColor: FormsTheme.bg,
  },
  countLine: { fontSize: 12, color: FormsTheme.textSecondary },
  summaryList: { gap: 12 },
  summaryCard: {
    backgroundColor: FormsTheme.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: FormsTheme.border,
    padding: 14,
    gap: 10,
  },
  summaryTitle: { fontSize: 14, fontWeight: '600', color: FormsTheme.text },
  barList: { gap: 8 },
  avgText: { fontSize: 12, color: FormsTheme.textSecondary },
  barWrap: { gap: 4 },
  barHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  barLabel: { flex: 1, fontSize: 12, color: FormsTheme.text },
  barCount: { fontSize: 11, color: FormsTheme.textSecondary },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: FormsTheme.bg, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: FormsTheme.purple, borderRadius: 4 },
  sampleList: { gap: 6 },
  sampleLine: {
    fontSize: 13,
    color: FormsTheme.text,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: FormsTheme.border,
    paddingBottom: 4,
  },
  moreText: { fontSize: 11, color: FormsTheme.textMuted },
  totalText: { fontSize: 11, color: FormsTheme.textMuted },
  individualList: { gap: 10 },
  responseCard: {
    backgroundColor: FormsTheme.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: FormsTheme.border,
    overflow: 'hidden',
  },
  responseHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  responseBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: FormsTheme.purpleLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  responseBadgeText: { fontSize: 11, fontWeight: '700', color: FormsTheme.purple },
  responseWhen: { fontSize: 13, fontWeight: '600', color: FormsTheme.text },
  responseEmail: { fontSize: 11, color: FormsTheme.textSecondary },
  responseScore: { fontSize: 11, fontWeight: '600', color: FormsTheme.purple },
  answerList: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: FormsTheme.border,
    padding: 12,
    gap: 10,
  },
  answerRow: { gap: 2 },
  answerQ: { fontSize: 11, fontWeight: '600', color: FormsTheme.textSecondary },
  answerA: { fontSize: 13, color: FormsTheme.text },
  loadMoreBtn: {
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: FormsTheme.border,
    borderRadius: 8,
    backgroundColor: FormsTheme.surface,
  },
  loadMoreText: { fontSize: 13, fontWeight: '600', color: FormsTheme.purple },
});
