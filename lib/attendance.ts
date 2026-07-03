import { uploadAsync, FileSystemUploadType } from 'expo-file-system/legacy';
import { supabase } from './supabase';
import { distanceMeters, getCurrentPosition } from './geo';
import { toDateKey } from './assignments';
import { faceAuth } from './face-auth';
import {
  GEO_RADIUS_M,
  FACE_VERIFICATION_ENABLED,
  type Assignment,
  type Attendance,
  type AdminAttendanceRow,
  type AssignmentWithStatus,
} from './types';

const BUCKET = 'attendance-photos';

/**
 * Complete attendance for an assignment:
 *  1. require the assignment is for today (assignments close at end of day),
 *  2. read the device's current location and require it within GEO_RADIUS_M,
 *  3. (when FACE_VERIFICATION_ENABLED) verify the selfie against the user's
 *     registered face — a photo is required in that case,
 *  4. upload the photo to private Storage, if one was provided,
 *  5. record the attendance row (which unlocks the form link in the UI).
 */
export async function submitAttendance(
  assignment: Assignment,
  photoUri?: string
): Promise<Attendance> {
  // 1. Day validity — assignments are only checkable-in on their assigned date.
  const today = toDateKey(new Date());
  if (assignment.assigned_date !== today) {
    throw new Error(
      `This assignment was only valid on ${assignment.assigned_date} and can no longer be checked into.`
    );
  }

  // 2. Geo check
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

  // 3. Face verification against the user's registered face (temporarily
  // disabled — see FACE_VERIFICATION_ENABLED in lib/types.ts)
  let verified = true;
  let similarity: number | null = null;
  if (FACE_VERIFICATION_ENABLED) {
    if (!photoUri) throw new Error('A photo is required for face verification.');
    const result = await faceAuth.verify(photoUri);
    if (!result.verified) {
      throw new Error(
        `Face didn't match your registered photo (similarity ${result.similarity.toFixed(2)}). Try again in good lighting.`
      );
    }
    verified = true;
    similarity = result.similarity;
  }

  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  const uid = sess.session?.user?.id;
  if (!token || !uid) throw new Error('Your session expired. Please sign in again.');

  // 4. Upload photo, if provided (binary PUT to Supabase Storage REST, authed with the session JWT)
  let path: string | null = null;
  if (photoUri) {
    path = `${uid}/${assignment.id}-${Date.now()}.jpg`;
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
  }

  // 5. Record attendance
  const { data, error } = await supabase
    .from('attendance')
    .insert({
      assignment_id: assignment.id,
      user_id: uid,
      photo_path: path,
      captured_lat: pos.lat,
      captured_lng: pos.lng,
      distance_m: distance,
      verified,
      face_similarity: similarity,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

/** Short-lived signed URL to view an uploaded attendance photo (null if none was captured). */
export async function getPhotoUrl(photoPath: string | null | undefined): Promise<string | null> {
  if (!photoPath) return null;
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(photoPath, 3600);
  return data?.signedUrl ?? null;
}

/**
 * Admin: every assignment for a date, with attendance + assignee — includes no-shows.
 * `assignments.user_id` has no FK to `profiles` (both reference `auth.users`
 * independently), so PostgREST can't embed `profiles` directly — join it client-side.
 */
export async function listAttendanceForDate(dateKey: string): Promise<AdminAttendanceRow[]> {
  const { data, error } = await supabase
    .from('assignments')
    .select('*, attendance:attendance(*)')
    .eq('assigned_date', dateKey)
    .order('created_at', { ascending: true });
  if (error) throw error;

  const rows = (data ?? []).map((row: any) => ({
    ...row,
    attendance: Array.isArray(row.attendance) ? (row.attendance[0] ?? null) : (row.attendance ?? null),
  }));

  const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
  const profileById = new Map<string, { display_name: string | null; email: string }>();
  if (userIds.length > 0) {
    const { data: profiles, error: profileErr } = await supabase
      .from('profiles')
      .select('id, display_name, email')
      .in('id', userIds);
    if (profileErr) throw profileErr;
    for (const p of profiles ?? []) profileById.set(p.id, { display_name: p.display_name, email: p.email });
  }

  return rows.map((row) => ({ ...row, profile: profileById.get(row.user_id) ?? null }));
}

/** Admin: one user's assignment/attendance history, most recent first. */
export async function listAttendanceForUser(userId: string, limit = 30): Promise<AssignmentWithStatus[]> {
  const { data, error } = await supabase
    .from('assignments')
    .select('*, attendance:attendance(*)')
    .eq('user_id', userId)
    .order('assigned_date', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    ...row,
    attendance: Array.isArray(row.attendance) ? (row.attendance[0] ?? null) : (row.attendance ?? null),
  }));
}
