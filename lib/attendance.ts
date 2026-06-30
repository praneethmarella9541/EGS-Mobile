import { uploadAsync, FileSystemUploadType } from 'expo-file-system/legacy';
import { supabase } from './supabase';
import { distanceMeters, getCurrentPosition } from './geo';
import { GEO_RADIUS_M, type Assignment, type Attendance } from './types';

const BUCKET = 'attendance-photos';

/**
 * Complete attendance for an assignment:
 *  1. read the device's current location and require it within GEO_RADIUS_M,
 *  2. upload the photo to private Storage,
 *  3. record the attendance row (which unlocks the form link in the UI).
 */
export async function submitAttendance(
  assignment: Assignment,
  photoUri: string
): Promise<Attendance> {
  // 1. Geo check
  const pos = await getCurrentPosition();
  const distance = distanceMeters(
    { lat: pos.lat, lng: pos.lng },
    { lat: assignment.latitude, lng: assignment.longitude }
  );
  if (distance > GEO_RADIUS_M) {
    throw new Error(
      `You're ${distance} m from the site — you must be within ${GEO_RADIUS_M} m to check in.`
    );
  }

  // 2. Upload photo (binary PUT to Supabase Storage REST, authed with the session JWT)
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  const uid = sess.session?.user?.id;
  if (!token || !uid) throw new Error('Your session expired. Please sign in again.');

  const path = `${uid}/${assignment.id}-${Date.now()}.jpg`;
  const uploadUrl = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`;
  const res = await uploadAsync(uploadUrl, photoUri, {
    httpMethod: 'POST',
    uploadType: FileSystemUploadType.BINARY_CONTENT,
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
      'Content-Type': 'image/jpeg',
      'x-upsert': 'true',
    },
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error('Photo upload failed. Check your connection and try again.');
  }

  // 3. Record attendance
  const { data, error } = await supabase
    .from('attendance')
    .insert({
      assignment_id: assignment.id,
      user_id: uid,
      photo_path: path,
      captured_lat: pos.lat,
      captured_lng: pos.lng,
      distance_m: distance,
      verified: true,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

/** Short-lived signed URL to view an uploaded attendance photo. */
export async function getPhotoUrl(photoPath: string): Promise<string | null> {
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(photoPath, 3600);
  return data?.signedUrl ?? null;
}
