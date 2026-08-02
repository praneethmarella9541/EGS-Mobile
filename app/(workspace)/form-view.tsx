import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { Colors } from '../../constants/colors';

/** In-app Google Form viewer. The user fills and submits the form here. */
export default function FormViewScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { url, title } = useLocalSearchParams<{ url?: string; title?: string }>();
  const [loading, setLoading] = useState(true);

  const formUrl = typeof url === 'string' ? url : '';

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={26} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>
          {title || 'Form'}
        </Text>
      </View>

      {formUrl ? (
        <View style={{ flex: 1 }}>
          <WebView
            source={{ uri: formUrl }}
            style={{ flex: 1 }}
            onLoadEnd={() => setLoading(false)}
            startInLoadingState
          />
          {loading && (
            <View style={styles.loader} pointerEvents="none">
              <ActivityIndicator color={Colors.primary} />
            </View>
          )}
        </View>
      ) : (
        <View style={styles.loader}>
          <Text style={{ color: Colors.textSecondary }}>No form link provided.</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingBottom: 12,
    backgroundColor: Colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  title: { flex: 1, fontSize: 17, fontWeight: '700', color: Colors.text },
  loader: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
});
