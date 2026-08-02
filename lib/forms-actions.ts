import * as Clipboard from 'expo-clipboard';
import { Alert, Platform, Share } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as IntentLauncher from 'expo-intent-launcher';

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

  // Android: open the OS "Open with" chooser so the admin can pick an app to
  // OPEN the CSV (Sheets, Excel, a file viewer…). ACTION_VIEW needs a content://
  // URI — file:// URIs can't be handed to other apps on Android 7+.
  if (Platform.OS === 'android') {
    try {
      const contentUri = await FileSystem.getContentUriAsync(path);
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: contentUri,
        type: 'text/csv',
        flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
      });
      return;
    } catch {
      // No app to view CSV (or intent failed) — fall through to the share sheet.
    }
  }

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(path, {
      mimeType: 'text/csv',
      UTI: 'public.comma-separated-values-text',
      dialogTitle: 'Open CSV with',
    });
  } else {
    await Clipboard.setStringAsync(csv);
    Alert.alert('CSV copied', 'Response data copied to clipboard.');
  }
}
