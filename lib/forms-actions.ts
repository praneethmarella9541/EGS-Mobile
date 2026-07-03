import * as Clipboard from 'expo-clipboard';
import { Alert, Share } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

export async function copyFormLink(link: string): Promise<void> {
  await Clipboard.setStringAsync(link);
  Alert.alert('Link copied', 'Form link copied to clipboard.');
}

export async function shareFormLink(link: string, title?: string): Promise<void> {
  try {
    await Share.share({
      message: title ? `${title}\n${link}` : link,
      url: link,
      title: title ?? 'Google Form',
    });
  } catch {
    await copyFormLink(link);
  }
}

export async function exportResponsesCsv(filename: string, csv: string): Promise<void> {
  const path = `${FileSystem.cacheDirectory ?? ''}${filename}`;
  await FileSystem.writeAsStringAsync(path, csv, { encoding: 'utf8' });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(path, {
      mimeType: 'text/csv',
      UTI: 'public.comma-separated-values-text',
    });
  } else {
    await Clipboard.setStringAsync(csv);
    Alert.alert('CSV copied', 'Response data copied to clipboard.');
  }
}
