import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, Switch, Modal, Pressable, useWindowDimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { FormsTheme } from '../../../../constants/formsTheme';
import { formsApi } from '../../../../lib/forms-api';
import { copyFormLink, shareFormLink } from '../../../../lib/forms-actions';
import { FormResponsesTab } from '../../../../components/forms/FormResponsesTab';
import {
  defaultChoiceBlock,
  defaultQuestionBlock,
  duplicateBlock,
  emptyEditorState,
  googleFormToEditorState,
  newSectionBlock,
  newTextBlock,
  type EditorBlock,
  type EditorBlockKind,
  type EditorState,
} from '../../../../lib/google-forms-editor-model';

type EditorTab = 'questions' | 'responses' | 'settings' | 'preview';

/** The question variant of EditorBlock (the only member with `required`). */
type QuestionBlock = Extract<EditorBlock, { required: boolean }>;

const EMAIL_OPTIONS: { value: EditorState['emailCollection']; label: string }[] = [
  { value: 'DO_NOT_COLLECT', label: 'Do not collect email' },
  { value: 'RESPONDER_INPUT', label: 'Ask for email on form' },
  { value: 'VERIFIED', label: 'Verified email (Workspace)' },
  { value: 'EMAIL_COLLECTION_TYPE_UNSPECIFIED', label: 'Google default' },
];

type AddOption = { label: string; icon: keyof typeof Ionicons.glyphMap; build: () => EditorBlock };

const ADD_OPTIONS: AddOption[] = [
  { label: 'Short answer',  icon: 'create-outline',           build: () => defaultQuestionBlock('short_text') },
  { label: 'Paragraph',     icon: 'reader-outline',           build: () => defaultQuestionBlock('paragraph') },
  { label: 'Multiple choice', icon: 'radio-button-on-outline', build: () => defaultChoiceBlock('multiple_choice') },
  { label: 'Checkboxes',    icon: 'checkbox-outline',         build: () => defaultChoiceBlock('checkboxes') },
  { label: 'Dropdown',      icon: 'chevron-down-circle-outline', build: () => defaultChoiceBlock('dropdown') },
  { label: 'Linear scale',  icon: 'options-outline',          build: () => defaultQuestionBlock('linear_scale') },
  { label: 'Date',          icon: 'calendar-outline',         build: () => defaultQuestionBlock('date') },
  { label: 'Time',          icon: 'time-outline',             build: () => defaultQuestionBlock('time') },
  { label: 'Section break', icon: 'remove-outline',           build: () => newSectionBlock() },
  { label: 'Title & description', icon: 'text-outline',       build: () => newTextBlock() },
];

function blockLabel(kind: EditorBlockKind): string {
  switch (kind) {
    case 'short_text':      return 'Short answer';
    case 'paragraph':       return 'Paragraph';
    case 'multiple_choice': return 'Multiple choice';
    case 'checkboxes':      return 'Checkboxes';
    case 'dropdown':        return 'Dropdown';
    case 'linear_scale':    return 'Linear scale';
    case 'date':            return 'Date';
    case 'time':            return 'Time';
    case 'section':         return 'Section';
    case 'text_block':      return 'Title & description';
    case 'unsupported':     return 'Unsupported';
    default:                return 'Question';
  }
}

export default function FormEditScreen() {
  const { formId: rawId, tab: tabParam } = useLocalSearchParams<{ formId: string; tab?: string }>();
  const formId = typeof rawId === 'string' ? rawId : '';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareWarning, setShareWarning] = useState<string | null>(null);
  const [titleWarning, setTitleWarning] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState>(() => emptyEditorState());
  const [responderUri, setResponderUri] = useState<string | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [tab, setTab] = useState<EditorTab>('questions');

  useEffect(() => {
    const t = typeof tabParam === 'string' ? tabParam : '';
    if (t === 'responses' || t === 'settings' || t === 'preview' || t === 'questions') {
      setTab(t);
    }
  }, [tabParam]);

  const load = useCallback(async () => {
    if (!formId) return;
    setLoading(true);
    setError(null);
    setShareWarning(null);
    setTitleWarning(null);
    try {
      const { form: data, shareWarning: warning, titleWarning: titleWarn } = await formsApi.getWithShareStatus(
        formId
      );
      setEditor(googleFormToEditorState(data));
      setResponderUri(typeof data.responderUri === 'string' ? (data.responderUri as string) : null);
      setShareWarning(warning);
      setTitleWarning(titleWarn);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load form');
    } finally {
      setLoading(false);
    }
  }, [formId]);

  useEffect(() => { load(); }, [load]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await formsApi.save(formId, editor);
      if (!res?.ok) throw new Error(res?.message || res?.error || 'Save failed');
      if (res.editorState) {
        setEditor(res.editorState as EditorState);
      } else if (res.form) {
        setEditor(googleFormToEditorState(res.form));
      }
      if (res.form && typeof res.form.responderUri === 'string') {
        setResponderUri(res.form.responderUri as string);
      }
      Alert.alert('Saved', res.noChanges ? 'No changes to save.' : 'Form saved to Google.');
    } catch (e: any) {
      const msg = e?.message ?? 'Save failed';
      setError(msg);
      Alert.alert('Save failed', msg);
    } finally {
      setSaving(false);
    }
  }

  function updateBlock(i: number, patch: Partial<EditorBlock>) {
    setEditor((prev) => {
      const blocks = [...prev.blocks];
      const cur = blocks[i];
      if (!cur) return prev;
      blocks[i] = { ...cur, ...patch } as EditorBlock;
      return { ...prev, blocks };
    });
  }

  function removeBlock(i: number) {
    setEditor((prev) => ({ ...prev, blocks: prev.blocks.filter((_, j) => j !== i) }));
  }

  function moveBlock(i: number, dir: -1 | 1) {
    setEditor((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.blocks.length) return prev;
      const blocks = [...prev.blocks];
      [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
      return { ...prev, blocks };
    });
  }

  function addBlock(build: () => EditorBlock) {
    setEditor((prev) => ({ ...prev, blocks: [...prev.blocks, build()] }));
    setAddOpen(false);
  }

  function duplicateBlockAt(i: number) {
    setEditor((prev) => {
      const block = prev.blocks[i];
      if (!block) return prev;
      const blocks = [...prev.blocks];
      blocks.splice(i + 1, 0, duplicateBlock(block));
      return { ...prev, blocks };
    });
  }

  async function shareResponderLink() {
    if (!responderUri) return;
    await shareFormLink(responderUri, editor.title?.trim() || 'Form');
  }

  if (loading) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator color={FormsTheme.purple} />
      </View>
    );
  }

  const emailLabel = EMAIL_OPTIONS.find((o) => o.value === editor.emailCollection)?.label ?? 'Do not collect email';

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="arrow-back" size={24} color={FormsTheme.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {editor.title?.trim() || 'Untitled form'}
          </Text>
        </View>
        <TouchableOpacity
          onPress={save}
          disabled={saving}
          style={[styles.saveBtn, saving && { opacity: 0.6 }]}
        >
          {saving
            ? <ActivityIndicator color={FormsTheme.fabIcon} size="small" />
            : <Text style={styles.saveBtnText}>Save</Text>}
        </TouchableOpacity>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabsScroll}
        contentContainerStyle={styles.tabs}
      >
        {(
          [
            { id: 'questions' as const, label: 'Questions', icon: 'list-outline' as const },
            { id: 'responses' as const, label: 'Responses', icon: 'mail-open-outline' as const },
            { id: 'settings' as const, label: 'Settings', icon: 'settings-outline' as const },
            { id: 'preview' as const, label: 'Preview', icon: 'eye-outline' as const },
          ]
        ).map(({ id, label, icon }) => (
          <TouchableOpacity
            key={id}
            style={[styles.tab, tab === id && styles.tabActive]}
            onPress={() => setTab(id)}
          >
            <Ionicons
              name={icon}
              size={14}
              color={tab === id ? FormsTheme.purple : FormsTheme.textMuted}
            />
            <Text style={[styles.tabText, tab === id && styles.tabTextActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 120 }}
        keyboardShouldPersistTaps="handled"
      >
        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {shareWarning ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>
              Field users may hit a Google sign-in wall opening this form: {shareWarning}
            </Text>
          </View>
        ) : null}

        {titleWarning ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>
              Could not fix this form's Drive file name (it'll keep showing as "Untitled form" in Google
              Forms/Drive): {titleWarning}
            </Text>
          </View>
        ) : null}

        {tab === 'responses' ? (
          <FormResponsesTab
            formId={formId}
            editorBlocks={editor.blocks}
            formTitle={editor.title}
            isQuiz={editor.isQuiz}
          />
        ) : tab === 'preview' ? (
          responderUri ? (
            <View style={styles.previewWrap}>
              <View style={styles.linkActions}>
                <TouchableOpacity style={styles.smallBtn} onPress={() => copyFormLink(responderUri)}>
                  <Ionicons name="copy-outline" size={14} color={FormsTheme.purple} />
                  <Text style={styles.smallBtnText}>Copy link</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.smallBtn} onPress={shareResponderLink}>
                  <Ionicons name="share-outline" size={14} color={FormsTheme.purple} />
                  <Text style={styles.smallBtnText}>Share</Text>
                </TouchableOpacity>
              </View>
              <View style={[styles.previewFrame, { height: Math.min(windowHeight * 0.55, 520) }]}>
                <WebView source={{ uri: responderUri }} style={{ flex: 1 }} startInLoadingState />
              </View>
            </View>
          ) : (
            <Text style={styles.hintText}>Save the form to generate a responder link for preview.</Text>
          )
        ) : tab === 'questions' ? (
          <>
            <View style={styles.titleCard}>
              <View style={styles.titleCardBand} />
              <TextInput
                style={styles.titleCardInput}
                value={editor.title}
                onChangeText={(t) => setEditor((s) => ({ ...s, title: t }))}
                placeholder="Untitled form"
                placeholderTextColor={FormsTheme.textMuted}
              />
              <TextInput
                style={styles.titleCardDesc}
                value={editor.description}
                onChangeText={(t) => setEditor((s) => ({ ...s, description: t }))}
                placeholder="Form description"
                placeholderTextColor={FormsTheme.textMuted}
                multiline
              />
            </View>

            {editor.blocks.length === 0 ? (
              <View style={styles.emptyHint}>
                <Text style={styles.emptyHintText}>Tap + to add your first question</Text>
              </View>
            ) : null}

            {editor.blocks.map((block, i) => (
              <BlockCard
                key={block.key}
                block={block}
                index={i}
                total={editor.blocks.length}
                onChange={(patch) => updateBlock(i, patch)}
                onRemove={() => removeBlock(i)}
                onMove={(dir) => moveBlock(i, dir)}
                onDuplicate={() => duplicateBlockAt(i)}
              />
            ))}
          </>
        ) : (
          <View style={styles.card}>
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Accepting responses</Text>
                <Text style={styles.fieldHint}>Turn off to close the form to new submissions</Text>
              </View>
              <Switch
                value={editor.acceptingResponses}
                onValueChange={(v) => setEditor((s) => ({ ...s, acceptingResponses: v }))}
                trackColor={{ false: FormsTheme.border, true: FormsTheme.purple }}
                thumbColor={FormsTheme.surface}
              />
            </View>

            <View style={styles.divider} />

            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Make this a quiz</Text>
                <Text style={styles.fieldHint}>Assign point values and review answers</Text>
              </View>
              <Switch
                value={editor.isQuiz}
                onValueChange={(v) => setEditor((s) => ({ ...s, isQuiz: v }))}
                trackColor={{ false: FormsTheme.border, true: FormsTheme.purple }}
                thumbColor={FormsTheme.surface}
              />
            </View>

            <Text style={styles.fieldHint}>
              Quiz grading and answer keys are managed in Google Forms. Placecom syncs quiz mode on save.
            </Text>

            <View style={styles.divider} />

            <Text style={styles.fieldLabel}>Collect email addresses</Text>
            <TouchableOpacity style={styles.select} onPress={() => setEmailOpen(true)}>
              <Text style={styles.selectText}>{emailLabel}</Text>
              <Ionicons name="chevron-down" size={18} color={FormsTheme.textMuted} />
            </TouchableOpacity>

            {responderUri ? (
              <>
                <View style={styles.divider} />
                <Text style={styles.fieldLabel}>Responder link</Text>
                <View style={styles.linkRow}>
                  <Text style={styles.linkText} numberOfLines={2}>{responderUri}</Text>
                </View>
                <View style={styles.linkActions}>
                  <TouchableOpacity
                    style={styles.smallBtn}
                    onPress={() => copyFormLink(responderUri)}
                  >
                    <Ionicons name="copy-outline" size={14} color={FormsTheme.purple} />
                    <Text style={styles.smallBtnText}>Copy link</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.smallBtn} onPress={shareResponderLink}>
                    <Ionicons name="share-outline" size={14} color={FormsTheme.purple} />
                    <Text style={styles.smallBtnText}>Share</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : null}
          </View>
        )}
      </ScrollView>

      {tab === 'questions' ? (
        <TouchableOpacity style={styles.fab} onPress={() => setAddOpen(true)} activeOpacity={0.85}>
          <Ionicons name="add" size={28} color={FormsTheme.fabIcon} />
        </TouchableOpacity>
      ) : null}

      {/* Email-collection picker */}
      <Modal visible={emailOpen} transparent animationType="fade" onRequestClose={() => setEmailOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setEmailOpen(false)}>
          <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Email collection</Text>
            {EMAIL_OPTIONS.map((opt) => {
              const selected = editor.emailCollection === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={styles.modalRow}
                  onPress={() => {
                    setEditor((s) => ({ ...s, emailCollection: opt.value }));
                    setEmailOpen(false);
                  }}
                >
                  <Text style={[styles.modalRowText, selected && { color: FormsTheme.purple, fontWeight: '700' }]}>
                    {opt.label}
                  </Text>
                  {selected ? <Ionicons name="checkmark" size={18} color={FormsTheme.purple} /> : null}
                </TouchableOpacity>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Add-block picker */}
      <Modal visible={addOpen} transparent animationType="slide" onRequestClose={() => setAddOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setAddOpen(false)}>
          <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Add to form</Text>
            <View style={styles.addGrid}>
              {ADD_OPTIONS.map((opt) => (
                <TouchableOpacity key={opt.label} style={styles.addItem} onPress={() => addBlock(opt.build)}>
                  <Ionicons name={opt.icon} size={18} color={FormsTheme.purple} />
                  <Text style={styles.addItemText}>{opt.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

/* -------- Block card -------- */

function BlockCard({
  block, index, total, onChange, onRemove, onMove, onDuplicate,
}: {
  block: EditorBlock;
  index: number;
  total: number;
  onChange: (patch: Partial<EditorBlock>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  onDuplicate: () => void;
}) {
  const accentColor =
    block.kind === 'section' || block.kind === 'text_block'
      ? FormsTheme.sectionAccent
      : FormsTheme.cardAccent;

  return (
    <View style={[styles.blockCard, { borderLeftColor: accentColor }]}>
      <View style={styles.blockHeader}>
        <View style={styles.kindBadge}>
          <Text style={styles.kindBadgeText}>{blockLabel(block.kind)}</Text>
        </View>
        <View style={{ flex: 1 }} />
        <TouchableOpacity
          style={styles.iconBtnSmall}
          onPress={() => onMove(-1)}
          disabled={index === 0}
        >
          <Ionicons name="arrow-up" size={16} color={index === 0 ? FormsTheme.textMuted : FormsTheme.text} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.iconBtnSmall}
          onPress={() => onMove(1)}
          disabled={index === total - 1}
        >
          <Ionicons name="arrow-down" size={16} color={index === total - 1 ? FormsTheme.textMuted : FormsTheme.text} />
        </TouchableOpacity>
        {block.kind !== 'unsupported' ? (
          <TouchableOpacity style={styles.iconBtnSmall} onPress={onDuplicate}>
            <Ionicons name="copy-outline" size={16} color={FormsTheme.text} />
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity style={styles.iconBtnSmall} onPress={onRemove}>
          <Ionicons name="trash-outline" size={16} color="#D93025" />
        </TouchableOpacity>
      </View>

      {block.kind === 'unsupported' ? (
        <Text style={styles.hintText}>{block.hint}</Text>
      ) : null}

      <Text style={styles.fieldLabelSmall}>Title</Text>
      <TextInput
        style={styles.input}
        value={block.title}
        onChangeText={(t) => onChange({ title: t } as Partial<EditorBlock>)}
        placeholder={block.kind === 'section' ? 'Section title' : 'Question title'}
        placeholderTextColor={FormsTheme.textMuted}
      />
      <Text style={styles.fieldLabelSmall}>Help text</Text>
      <TextInput
        style={[styles.input, styles.inputMulti]}
        value={block.description}
        onChangeText={(t) => onChange({ description: t } as Partial<EditorBlock>)}
        placeholder="Optional description"
        placeholderTextColor={FormsTheme.textMuted}
        multiline
      />

      {/* Required toggle for all question types */}
      {block.kind !== 'section' && block.kind !== 'text_block' && block.kind !== 'unsupported' ? (
        <View style={styles.switchRow}>
          <Text style={styles.fieldLabel}>Required</Text>
          <Switch
            value={'required' in block ? Boolean(block.required) : false}
            onValueChange={(v) => onChange({ required: v } as Partial<EditorBlock>)}
            trackColor={{ false: FormsTheme.border, true: FormsTheme.purple }}
            thumbColor={FormsTheme.surface}
          />
        </View>
      ) : null}

      {/* Choice options */}
      {(block.kind === 'multiple_choice' || block.kind === 'checkboxes' || block.kind === 'dropdown') ? (
        <ChoiceOptionsEditor block={block} onChange={onChange} />
      ) : null}

      {/* Linear scale */}
      {block.kind === 'linear_scale' ? (
        <LinearScaleEditor block={block} onChange={onChange} />
      ) : null}

      {/* Date */}
      {block.kind === 'date' ? (
        <View style={styles.toggleRow}>
          <ToggleField
            label="Include year"
            value={block.dateIncludeYear !== false}
            onChange={(v) => onChange({ dateIncludeYear: v } as Partial<EditorBlock>)}
          />
          <ToggleField
            label="Include time"
            value={Boolean(block.dateIncludeTime)}
            onChange={(v) => onChange({ dateIncludeTime: v } as Partial<EditorBlock>)}
          />
        </View>
      ) : null}

      {/* Time */}
      {block.kind === 'time' ? (
        <ToggleField
          label="Duration (elapsed time)"
          value={Boolean(block.timeDuration)}
          onChange={(v) => onChange({ timeDuration: v } as Partial<EditorBlock>)}
        />
      ) : null}
    </View>
  );
}

function ChoiceOptionsEditor({
  block,
  onChange,
}: {
  block: QuestionBlock;
  onChange: (patch: Partial<EditorBlock>) => void;
}) {
  const opts = block.choiceOptions || [];
  return (
    <View>
      <Text style={styles.fieldLabelSmall}>Options</Text>
      {opts.map((opt, j) => (
        <View key={j} style={styles.optionRow}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={opt}
            onChangeText={(t) => {
              const next = [...opts];
              next[j] = t;
              onChange({ choiceOptions: next } as Partial<EditorBlock>);
            }}
            placeholder={`Option ${j + 1}`}
            placeholderTextColor={FormsTheme.textMuted}
          />
          <TouchableOpacity
            style={styles.optionRemove}
            onPress={() => {
              const next = opts.filter((_, k) => k !== j);
              onChange({ choiceOptions: next } as Partial<EditorBlock>);
            }}
          >
            <Ionicons name="close" size={16} color="#D93025" />
          </TouchableOpacity>
        </View>
      ))}
      <TouchableOpacity
        style={styles.addOption}
        onPress={() => onChange({ choiceOptions: [...opts, `Option ${opts.length + 1}`] } as Partial<EditorBlock>)}
      >
        <Ionicons name="add" size={16} color={FormsTheme.purple} />
        <Text style={styles.addOptionText}>Add option</Text>
      </TouchableOpacity>
      <View style={[styles.switchRow, { marginTop: 6 }]}>
        <Text style={styles.fieldHint}>Shuffle option order</Text>
        <Switch
          value={Boolean(block.shuffle)}
          onValueChange={(v) => onChange({ shuffle: v } as Partial<EditorBlock>)}
          trackColor={{ false: FormsTheme.border, true: FormsTheme.purple }}
          thumbColor={FormsTheme.surface}
        />
      </View>
    </View>
  );
}

function LinearScaleEditor({
  block,
  onChange,
}: {
  block: QuestionBlock;
  onChange: (patch: Partial<EditorBlock>) => void;
}) {
  return (
    <View>
      <View style={styles.gridRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.fieldLabelSmall}>Low</Text>
          <TextInput
            style={styles.input}
            value={String(block.scaleLow ?? 1)}
            onChangeText={(t) => onChange({ scaleLow: parseInt(t, 10) || 0 } as Partial<EditorBlock>)}
            keyboardType="number-pad"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.fieldLabelSmall}>High</Text>
          <TextInput
            style={styles.input}
            value={String(block.scaleHigh ?? 5)}
            onChangeText={(t) => onChange({ scaleHigh: parseInt(t, 10) || 0 } as Partial<EditorBlock>)}
            keyboardType="number-pad"
          />
        </View>
      </View>
      <View style={styles.gridRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.fieldLabelSmall}>Low label</Text>
          <TextInput
            style={styles.input}
            value={block.scaleLowLabel || ''}
            onChangeText={(t) => onChange({ scaleLowLabel: t } as Partial<EditorBlock>)}
            placeholder="e.g. Poor"
            placeholderTextColor={FormsTheme.textMuted}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.fieldLabelSmall}>High label</Text>
          <TextInput
            style={styles.input}
            value={block.scaleHighLabel || ''}
            onChangeText={(t) => onChange({ scaleHighLabel: t } as Partial<EditorBlock>)}
            placeholder="e.g. Excellent"
            placeholderTextColor={FormsTheme.textMuted}
          />
        </View>
      </View>
    </View>
  );
}

function ToggleField({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.switchRow}>
      <Text style={styles.fieldHint}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: FormsTheme.border, true: FormsTheme.purple }}
        thumbColor={FormsTheme.surface}
      />
    </View>
  );
}

/* -------- styles -------- */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: FormsTheme.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: FormsTheme.bg },
  scroll: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: FormsTheme.surface,
    borderBottomWidth: 1,
    borderBottomColor: FormsTheme.border,
  },
  iconBtn: { padding: 6 },
  iconBtnSmall: { padding: 6, marginLeft: 2 },
  headerTitle: { fontSize: 18, fontWeight: '400', color: FormsTheme.text },
  saveBtn: {
    backgroundColor: FormsTheme.purple,
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 4,
    minWidth: 64,
    alignItems: 'center',
  },
  saveBtnText: { color: FormsTheme.fabIcon, fontWeight: '600', fontSize: 14 },
  tabsScroll: {
    backgroundColor: FormsTheme.surface,
    borderBottomWidth: 1,
    borderBottomColor: FormsTheme.border,
    maxHeight: 48,
  },
  tabs: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    gap: 4,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  tabActive: { borderBottomWidth: 3, borderBottomColor: FormsTheme.purple },
  tabText: { fontSize: 13, fontWeight: '500', color: FormsTheme.textSecondary },
  tabTextActive: { color: FormsTheme.purple, fontWeight: '600' },
  previewWrap: { gap: 12 },
  previewFrame: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: FormsTheme.border,
    overflow: 'hidden',
    backgroundColor: FormsTheme.surface,
  },
  titleCard: {
    backgroundColor: FormsTheme.surface,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: FormsTheme.border,
  },
  titleCardBand: { height: 10, backgroundColor: FormsTheme.headerBand },
  titleCardInput: {
    fontSize: 24,
    fontWeight: '400',
    color: FormsTheme.text,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  titleCardDesc: {
    fontSize: 14,
    color: FormsTheme.text,
    paddingHorizontal: 16,
    paddingBottom: 16,
    minHeight: 48,
    textAlignVertical: 'top',
  },

  card: {
    backgroundColor: FormsTheme.surface,
    borderRadius: 8,
    padding: 14,
    gap: 8,
    borderWidth: 1,
    borderColor: FormsTheme.border,
  },
  divider: { height: 1, backgroundColor: FormsTheme.divider, marginVertical: 6 },

  fieldLabel: { fontSize: 12, fontWeight: '700', color: FormsTheme.text },
  fieldLabelSmall: { fontSize: 11, fontWeight: '600', color: FormsTheme.textSecondary, marginTop: 6, marginBottom: 4 },
  fieldHint: { fontSize: 12, color: FormsTheme.textSecondary },

  input: {
    borderWidth: 1,
    borderColor: FormsTheme.border,
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: FormsTheme.text,
    backgroundColor: FormsTheme.surface,
  },
  inputMulti: { minHeight: 64, textAlignVertical: 'top' },

  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 4 },

  select: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderColor: FormsTheme.border, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 11,
    backgroundColor: FormsTheme.surface,
  },
  selectText: { fontSize: 14, color: FormsTheme.text },

  linkRow: {
    borderWidth: 1,
    borderColor: FormsTheme.border,
    borderRadius: 4,
    padding: 10,
    backgroundColor: FormsTheme.bg,
  },
  linkText: { fontSize: 12, color: FormsTheme.textSecondary, fontFamily: 'Menlo' },
  linkActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  smallBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 7,
    borderWidth: 1, borderColor: FormsTheme.border, borderRadius: 6,
  },
  smallBtnText: { fontSize: 12, fontWeight: '600', color: FormsTheme.purple },

  emptyHint: {
    padding: 18, borderRadius: 12, backgroundColor: FormsTheme.surface,
    borderWidth: 1, borderColor: FormsTheme.border, borderStyle: 'dashed',
    alignItems: 'center',
  },
  emptyHintText: { fontSize: 13, color: FormsTheme.textMuted },

  blockCard: {
    backgroundColor: FormsTheme.surface,
    borderRadius: 8,
    padding: 12,
    gap: 6,
    borderWidth: 1,
    borderColor: FormsTheme.border,
    borderLeftWidth: 6,
  },
  blockHeader: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  kindBadge: {
    backgroundColor: FormsTheme.purpleLight,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  kindBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: FormsTheme.purple,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  hintText: { fontSize: 12, color: FormsTheme.textSecondary, lineHeight: 17, marginVertical: 4 },

  optionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  optionRemove: { padding: 8 },
  addOption: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6 },
  addOptionText: { fontSize: 13, fontWeight: '600', color: FormsTheme.purple },

  gridRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  toggleRow: { flexDirection: 'column', gap: 0 },

  fab: {
    position: 'absolute',
    right: 18,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: FormsTheme.fab,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 10, elevation: 6,
  },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: FormsTheme.surface,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 18, paddingBottom: 30, gap: 6,
  },
  modalTitle: { fontSize: 15, fontWeight: '700', color: FormsTheme.text, marginBottom: 8 },
  modalRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: FormsTheme.divider,
  },
  modalRowText: { fontSize: 14, color: FormsTheme.text },

  addGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  addItem: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: FormsTheme.border, borderRadius: 10,
    backgroundColor: FormsTheme.bg,
    minWidth: '47%',
  },
  addItemText: { fontSize: 13, fontWeight: '600', color: FormsTheme.text },

  errorBox: {
    backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FEE2E2',
    padding: 10, borderRadius: 8,
  },
  errorText: { fontSize: 12, color: '#D93025' },
});
