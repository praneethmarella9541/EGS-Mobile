import * as ImageManipulator from 'expo-image-manipulator';

/** Resize and compress face photo for reliable InsightFace detection */
export async function prepareFacePhoto(uri: string): Promise<string> {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 1024 } }],
    {
      compress: 0.92,
      format: ImageManipulator.SaveFormat.JPEG,
    }
  );
  return result.uri;
}
