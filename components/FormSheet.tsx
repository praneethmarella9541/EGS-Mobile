import { useEffect } from 'react';
import { BackHandler, KeyboardAvoidingView, StyleSheet, View, type ViewStyle } from 'react-native';

type Props = {
  visible: boolean;
  onRequestClose: () => void;
  children: React.ReactNode;
  /** 'flex-end' = bottom sheet (default), 'center' = centered card. */
  justify?: 'flex-end' | 'center';
  /** Extra style merged onto the backdrop (e.g. alignItems/padding for a centered card). */
  backdropStyle?: ViewStyle;
};

/**
 * Bottom-sheet / centered form overlay for screens with a TextInput inside.
 *
 * Deliberately NOT React Native's <Modal>: on Android, Modal renders as a
 * separate native window that gets its own (partial, inconsistent) keyboard
 * adjustment independent of KeyboardAvoidingView — no amount of padding math
 * fixes it reliably (verified: plain KeyboardAvoidingView under-shifts, adding
 * manual keyboard-height padding on top over-shifts). Rendering the sheet
 * in-tree instead lets KeyboardAvoidingView behave exactly like it already
 * does, correctly, on regular screens (login, visit-new, visit-edit).
 */
export function FormSheet({
  visible,
  onRequestClose,
  children,
  justify = 'flex-end',
  backdropStyle,
}: Props) {
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onRequestClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onRequestClose]);

  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      <KeyboardAvoidingView
        style={[styles.backdrop, { justifyContent: justify }, backdropStyle]}
        behavior="padding"
      >
        {children}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
    elevation: 10,
  },
  backdrop: { flex: 1 },
});
