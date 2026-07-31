import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Modal, Pressable, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { Colors } from '../constants/colors';

/** Languages offered for dictation — common Indian regional languages + English. */
const DICTATION_LANGUAGES: { code: string; label: string }[] = [
  { code: 'en-IN', label: 'English (India)' },
  { code: 'hi-IN', label: 'Hindi' },
  { code: 'ta-IN', label: 'Tamil' },
  { code: 'te-IN', label: 'Telugu' },
  { code: 'kn-IN', label: 'Kannada' },
  { code: 'ml-IN', label: 'Malayalam' },
  { code: 'mr-IN', label: 'Marathi' },
  { code: 'bn-IN', label: 'Bengali' },
  { code: 'gu-IN', label: 'Gujarati' },
  { code: 'pa-IN', label: 'Punjabi' },
  { code: 'ur-IN', label: 'Urdu' },
];

type Props = {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
};

/**
 * A notes textarea with hold-to-dictate speech-to-text and a language picker
 * (English + common Indian regional languages). Shared by visit-new.tsx and
 * visit-edit.tsx so both stay in sync — this used to be duplicated inline and
 * drifted (dictation missing from the edit screen).
 */
export function DictationNotesField({ value, onChangeText, placeholder }: Props) {
  const [listening, setListening] = useState(false);
  const [dictationLang, setDictationLang] = useState(DICTATION_LANGUAGES[0]);
  const [langPickerOpen, setLangPickerOpen] = useState(false);

  // Always mirrors the latest committed value, so a new dictation session
  // (press again after releasing) appends to what's really there instead of a
  // stale value captured in a closure.
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);
  // What the text looked like right before the current press-and-hold session started.
  const sessionBaseRef = useRef('');

  useSpeechRecognitionEvent('start', () => setListening(true));
  useSpeechRecognitionEvent('end', () => setListening(false));
  useSpeechRecognitionEvent('result', (event) => {
    const transcript = event.results[0]?.transcript ?? '';
    const base = sessionBaseRef.current;
    const next = base ? `${base} ${transcript}` : transcript;
    valueRef.current = next;
    onChangeText(next);
  });
  useSpeechRecognitionEvent('error', (event) => {
    setListening(false);
    if (event.error === 'not-allowed') {
      Alert.alert('Microphone access needed', 'Allow microphone and speech recognition access to dictate notes.');
    } else if (event.error === 'language-not-supported') {
      Alert.alert('Language not available', `${dictationLang.label} isn't supported for dictation on this device.`);
    } else if (event.error !== 'no-speech') {
      Alert.alert('Dictation error', event.message || event.error);
    }
  });

  async function startDictation() {
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Microphone access needed', 'Allow microphone and speech recognition access to dictate notes.');
      return;
    }
    sessionBaseRef.current = valueRef.current;
    ExpoSpeechRecognitionModule.start({ lang: dictationLang.code, interimResults: true, continuous: true });
  }

  function stopDictation() {
    ExpoSpeechRecognitionModule.stop();
  }

  function toggleDictation() {
    if (listening) {
      stopDictation();
    } else {
      startDictation();
    }
  }

  return (
    <View>
      <View style={styles.detailsHeader}>
        <Text style={styles.fieldLabel}>Details</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TouchableOpacity style={styles.langBtn} onPress={() => setLangPickerOpen(true)} hitSlop={8}>
            <Text style={styles.langBtnText}>{dictationLang.label}</Text>
            <Ionicons name="chevron-down" size={12} color={Colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.micBtn, listening && styles.micBtnActive]}
            onPress={toggleDictation}
            hitSlop={8}
          >
            <Ionicons name={listening ? 'mic' : 'mic-outline'} size={16} color={listening ? '#fff' : Colors.primary} />
            <Text style={[styles.micBtnText, listening && { color: '#fff' }]}>
              {listening ? 'Listening…' : 'Tap to dictate'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
      <TextInput
        style={styles.notesInput}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder ?? 'Any details…'}
        placeholderTextColor={Colors.textMuted}
        multiline
      />

      <Modal visible={langPickerOpen} transparent animationType="fade" onRequestClose={() => setLangPickerOpen(false)}>
        <Pressable style={styles.langModalBackdrop} onPress={() => setLangPickerOpen(false)}>
          <Pressable style={styles.langModalSheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.langModalTitle}>Dictation language</Text>
            {DICTATION_LANGUAGES.map((lang) => (
              <TouchableOpacity
                key={lang.code}
                style={styles.langOption}
                onPress={() => {
                  setDictationLang(lang);
                  setLangPickerOpen(false);
                }}
              >
                <Text
                  style={[
                    styles.langOptionText,
                    lang.code === dictationLang.code && { color: Colors.primary, fontWeight: '700' },
                  ]}
                >
                  {lang.label}
                </Text>
                {lang.code === dictationLang.code ? (
                  <Ionicons name="checkmark" size={18} color={Colors.primary} />
                ) : null}
              </TouchableOpacity>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom: 6,
  },
  detailsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
    marginBottom: 6,
  },
  micBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: Colors.primary,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  micBtnActive: { backgroundColor: Colors.primary },
  micBtnText: { fontSize: 12, fontWeight: '600', color: Colors.primary },
  langBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  langBtnText: { fontSize: 12, fontWeight: '600', color: Colors.primary },
  langModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  langModalSheet: {
    width: '100%',
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 8,
    maxHeight: '70%',
  },
  langModalTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  langOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  langOptionText: { fontSize: 14, color: Colors.text },
  notesInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.text,
    backgroundColor: Colors.surface,
    minHeight: 100,
    textAlignVertical: 'top',
  },
});
