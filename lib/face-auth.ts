import { readAsStringAsync, EncodingType } from 'expo-file-system/legacy';
import { callEdge } from './edge';

async function toBase64(uri: string): Promise<string> {
  return readAsStringAsync(uri, { encoding: EncodingType.Base64 });
}

export const faceAuth = {
  /** Register a face from two selfies — the second cross-verifies the first (quality gate). */
  async register(
    photo1Uri: string,
    photo2Uri: string
  ): Promise<{ ok: boolean; similarity: number; threshold: number }> {
    const [photo1Base64, photo2Base64] = await Promise.all([toBase64(photo1Uri), toBase64(photo2Uri)]);
    return callEdge('face-auth', { action: 'register', photo1Base64, photo2Base64 });
  },

  /** Verify a check-in selfie against the caller's registered face. */
  async verify(photoUri: string): Promise<{ verified: boolean; similarity: number; threshold: number }> {
    const photoBase64 = await toBase64(photoUri);
    return callEdge('face-auth', { action: 'verify', photoBase64 });
  },
};
