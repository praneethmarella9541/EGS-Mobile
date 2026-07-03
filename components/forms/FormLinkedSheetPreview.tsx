import React from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';

/** Embeds a linked Google Sheet (responses spreadsheet) when one exists. */
export function FormLinkedSheetPreview({ sheetId }: { sheetId: string; formTitle: string }) {
  return (
    <View style={styles.frame}>
      <WebView
        source={{ uri: `https://docs.google.com/spreadsheets/d/${sheetId}/preview` }}
        style={{ flex: 1 }}
        startInLoadingState
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { height: 480, borderRadius: 8, overflow: 'hidden' },
});
