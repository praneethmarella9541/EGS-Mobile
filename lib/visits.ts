import { uploadAsync, FileSystemUploadType, downloadAsync, cacheDirectory } from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { supabase } from './supabase';
import { toDateKey } from './assignments';
import { distanceMeters, getCurrentPosition } from './geo';
import {
  GEO_RADIUS_M,
  type Assignment,
  type LocationVisit,
  type VisitPhoto,
  type AssignmentWithVisits,
  type AdminAssignmentRow,
} from './types';

const BUCKET = 'visit-photos';

function sortVisits(visits: LocationVisit[]): LocationVisit[] {
  return [...visits].sort((a, b) => new Date(a.submitted_at).getTime() - new Date(b.submitted_at).getTime());
}

/** Uploads photos for a visit and inserts their visit_photos rows. */
async function uploadVisitPhotos(
  uid: string,
  visitId: string,
  photoUris: string[],
  token: string
): Promise<VisitPhoto[]> {
  const photoPaths: string[] = [];
  for (let i = 0; i < photoUris.length; i++) {
    const path = `${uid}/${visitId}/${i}-${Date.now()}.jpg`;
    const uploadUrl = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`;
    const res = await uploadAsync(uploadUrl, photoUris[i], {
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
      throw new Error('A photo failed to upload. Check your connection and try again.');
    }
    photoPaths.push(path);
  }
  if (photoPaths.length === 0) return [];
  const { data: photoRows, error } = await supabase
    .from('visit_photos')
    .insert(photoPaths.map((photo_path) => ({ visit_id: visitId, photo_path })))
    .select('*');
  if (error) throw error;
  return photoRows ?? [];
}

/**
 * Log a location visit within an assigned area:
 *  1. require the assignment is for today (assignments close at end of day),
 *  2. require the device's live GPS is within GEO_RADIUS_M of the address the
 *     user typed/picked,
 *  3. record the place, live GPS, distance, and notes,
 *  4. bulk-upload any photos to private Storage,
 *  5. return the visit with its photos attached.
 *
 * Note for later: when FACE_VERIFICATION_ENABLED (lib/types.ts) is re-enabled,
 * face verification would plug in here — e.g. requiring the first photo to
 * match the user's registered face — not implemented now.
 */
export async function createVisit(input: {
  assignment: Assignment;
  placeLabel: string;
  /** Coordinates of the address the user typed/picked (the claimed location). */
  addressLat: number;
  addressLng: number;
  /** The device's live GPS reading (the actual location, for geofencing). */
  deviceLat: number;
  deviceLng: number;
  notes: string;
  photoUris: string[];
}): Promise<LocationVisit> {
  const today = toDateKey(new Date());
  if (input.assignment.assigned_date !== today) {
    throw new Error(`This area was only assigned for ${input.assignment.assigned_date} and is now closed.`);
  }

  const distance = distanceMeters(
    { lat: input.addressLat, lng: input.addressLng },
    { lat: input.deviceLat, lng: input.deviceLng }
  );
  if (distance > GEO_RADIUS_M) {
    throw new Error(
      `You're ${distance} m from that address — you must be within ${GEO_RADIUS_M} m to log this visit.`
    );
  }

  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  const uid = sess.session?.user?.id;
  if (!token || !uid) throw new Error('Your session expired. Please sign in again.');

  const { data: visit, error: visitErr } = await supabase
    .from('location_visits')
    .insert({
      assignment_id: input.assignment.id,
      user_id: uid,
      place_label: input.placeLabel.trim(),
      latitude: input.deviceLat,
      longitude: input.deviceLng,
      distance_m: distance,
      notes: input.notes.trim(),
    })
    .select('*')
    .single();
  if (visitErr) throw visitErr;

  const photos = await uploadVisitPhotos(uid, visit.id, input.photoUris, token);
  return { ...visit, photos };
}

/**
 * Edit an already-logged visit's notes and/or photos (place/GPS/geofence are
 * locked in at creation and can't be changed here). Editable anytime — no
 * EOD lock, unlike creating a new visit.
 */
export async function updateVisit(
  visitId: string,
  input: { notes: string; addPhotoUris?: string[] }
): Promise<LocationVisit> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  const uid = sess.session?.user?.id;
  if (!token || !uid) throw new Error('Your session expired. Please sign in again.');

  const { data: visit, error } = await supabase
    .from('location_visits')
    .update({ notes: input.notes.trim() })
    .eq('id', visitId)
    .select('*, photos:visit_photos(*)')
    .single();
  if (error) throw error;

  let photos: VisitPhoto[] = visit.photos ?? [];
  if (input.addPhotoUris?.length) {
    const newPhotos = await uploadVisitPhotos(uid, visitId, input.addPhotoUris, token);
    photos = [...photos, ...newPhotos];
  }
  return { ...visit, photos };
}

/** Fetch a single visit (with photos) by id — for the edit screen. */
export async function getVisit(visitId: string): Promise<LocationVisit> {
  const { data, error } = await supabase
    .from('location_visits')
    .select('*, photos:visit_photos(*)')
    .eq('id', visitId)
    .single();
  if (error) throw error;
  return data;
}

/**
 * Re-verify the user is still within GEO_RADIUS_M of where a visit was logged
 * before letting them reopen the form for it (e.g. to fill it again later).
 * Throws if too far away.
 */
export async function verifyStillNearVisit(visit: LocationVisit): Promise<void> {
  const device = await getCurrentPosition();
  const distance = distanceMeters(
    { lat: visit.latitude, lng: visit.longitude },
    { lat: device.lat, lng: device.lng }
  );
  if (distance > GEO_RADIUS_M) {
    throw new Error(
      `You're ${distance} m from where you logged this visit — you must be within ${GEO_RADIUS_M} m to reopen the form.`
    );
  }
}

/** Remove one photo from a visit (storage object + row). */
export async function deleteVisitPhoto(photo: VisitPhoto): Promise<void> {
  await supabase.storage.from(BUCKET).remove([photo.photo_path]);
  const { error } = await supabase.from('visit_photos').delete().eq('id', photo.id);
  if (error) throw error;
}

/** Download a visit photo to the device's photo gallery. */
export async function downloadPhotoToGallery(photoUrl: string, filename: string): Promise<void> {
  const perm = await MediaLibrary.requestPermissionsAsync();
  if (!perm.granted) throw new Error('Photo library access is required to save images.');
  const localUri = `${cacheDirectory}${filename}`;
  const { uri } = await downloadAsync(photoUrl, localUri);
  await MediaLibrary.saveToLibraryAsync(uri);
}

/** Today's (or any date's) visits logged so far for one area assignment. */
export async function listVisits(assignmentId: string): Promise<LocationVisit[]> {
  const { data, error } = await supabase
    .from('location_visits')
    .select('*, photos:visit_photos(*)')
    .eq('assignment_id', assignmentId)
    .order('submitted_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Short-lived signed URL to view an uploaded visit photo. */
export async function getPhotoUrl(photoPath: string | null | undefined): Promise<string | null> {
  if (!photoPath) return null;
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(photoPath, 3600);
  return data?.signedUrl ?? null;
}

/**
 * Admin: every area assignment for a date, with its visits + assignee — includes no-shows.
 * `assignments.user_id` has no FK to `profiles` (both reference `auth.users`
 * independently), so PostgREST can't embed `profiles` directly — join it client-side.
 */
export async function listAdminAssignmentsForDate(dateKey: string): Promise<AdminAssignmentRow[]> {
  const { data, error } = await supabase
    .from('assignments')
    .select('*, visits:location_visits(*, photos:visit_photos(*))')
    .eq('assigned_date', dateKey)
    .order('created_at', { ascending: true });
  if (error) throw error;

  const rows = (data ?? []).map((row: any) => ({ ...row, visits: sortVisits(row.visits ?? []) }));

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

/** Admin: one user's area-assignment/visit history, most recent first. */
export async function listAdminAssignmentsForUser(
  userId: string,
  limit = 30
): Promise<AssignmentWithVisits[]> {
  const { data, error } = await supabase
    .from('assignments')
    .select('*, visits:location_visits(*, photos:visit_photos(*))')
    .eq('user_id', userId)
    .order('assigned_date', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((row: any) => ({ ...row, visits: sortVisits(row.visits ?? []) }));
}
