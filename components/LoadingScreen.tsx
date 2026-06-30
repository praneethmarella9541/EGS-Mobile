import React from 'react';
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';
import { Colors } from '../constants/colors';

interface Props {
  message?: string;
}

export default function LoadingScreen({ message = 'Loading…' }: Props) {
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={Colors.primary} />
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
    gap: 12,
  },
  message: { fontSize: 15, color: Colors.textSecondary },
});
