import { uploadAsync, FileSystemUploadType, downloadAsync, cacheDirectory } from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { supabase } from './supabase';
import { callEdge } from './edge';
import { toDateKey } from './assignments';
import { distanceMeters, getCurrentPosition } from './geo';
import {
  GEO_RADIUS_M,
  type Assignment,
  type LocationVisit,
  type VisitPhoto,
  type AssignmentWithVisits,
  type AdminAssignmentRow,
  type PlaceSource,
} from './types';

function sortVisits(visits: LocationVisit[]): LocationVisit[] {
  return [...visits].sort((a, b) => new Date(a.submitted_at).getTime() - new Date(b.submitted_at).getTime());
}

/**
 * Uploads photos for a visit and inserts their visit_photos rows.
 *
 * Photos live in a private GCS bucket, which can't authorize a Supabase JWT, so
 * the `gcs-sign` Edge Function checks the caller owns the visit and hands back
 * short-lived signed PUT URLs. It also chooses the object paths — the client
 * never picks where a file lands.
 */
async function uploadVisitPhotos(visitId: string, photoUris: string[]): Promise<VisitPhoto[]> {
  if (photoUris.length === 0) return [];

  const { uploads } = await callEdge<{ uploads: { path: string; url: string }[] }>('gcs-sign', {
    action: 'upload',
    visitId,
    count: photoUris.length,
  });

  const photoPaths: string[] = [];
  for (let i = 0; i < photoUris.length; i++) {
    const res = await uploadAsync(uploads[i].url, photoUris[i], {
      httpMethod: 'PUT',
      uploadType: FileSystemUploadType.BINARY_CONTENT,
      headers: { 'Content-Type': 'image/jpeg' },
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error('A photo failed to upload. Check your connection and try again.');
    }
    photoPaths.push(uploads[i].path);
  }
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
 *  2. require the device's live GPS is within GEO_RADIUS_M of the picked place,
 *  3. record the place (with its provenance), live GPS, distance, and notes,
 *  4. bulk-upload any photos to private Storage,
 *  5. return the visit with its photos attached.
 *
 * The place normally comes from the GPS fix itself (NearbyPlacePicker), so step
 * 2 reads near-zero at pick time. Callers must pass a *freshly re-read* GPS
 * position here rather than the one the place was fetched with — that is what
 * makes the check meaningful, catching a user who fetches at the school and
 * submits later from elsewhere.
 *
 * Note for later: when FACE_VERIFICATION_ENABLED (lib/types.ts) is re-enabled,
 * face verification would plug in here — e.g. requiring the first photo to
 * match the user's registered face — not implemented now.
 */
export async function createVisit(input: {
  assignment: Assignment;
  placeLabel: string;
  /** Coordinates of the picked place (machine-captured, never user-typed). */
  addressLat: number;
  addressLng: number;
  /** The device's live GPS reading at submit time (the actual location). */
  deviceLat: number;
  deviceLng: number;
  notes: string;
  photoUris: string[];
  placeId?: string | null;
  placeSource?: PlaceSource | null;
  labelEdited?: boolean;
  gpsAccuracyM?: number | null;
  fetchedAt?: string | null;
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
      `You're ${distance} m from that place — you must be within ${GEO_RADIUS_M} m to log this visit. ` +
        `If you've moved, fetch your location again.`
    );
  }

  const { data: sess } = await supabase.auth.getSession();
  const uid = sess.session?.user?.id;
  if (!uid) throw new Error('Your session expired. Please sign in again.');

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
      place_id: input.placeId ?? null,
      place_source: input.placeSource ?? null,
      label_edited: input.labelEdited ?? false,
      gps_accuracy_m: input.gpsAccuracyM ?? null,
      fetched_at: input.fetchedAt ?? null,
    })
    .select('*')
    .single();
  if (visitErr) throw visitErr;

  const photos = await uploadVisitPhotos(visit.id, input.photoUris);
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
  const { data: visit, error } = await supabase
    .from('location_visits')
    .update({ notes: input.notes.trim() })
    .eq('id', visitId)
    .select('*, photos:visit_photos(*)')
    .single();
  if (error) throw error;

  let photos: VisitPhoto[] = visit.photos ?? [];
  if (input.addPhotoUris?.length) {
    const newPhotos = await uploadVisitPhotos(visitId, input.addPhotoUris);
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

/** Remove one photo from a visit (GCS object + row). */
export async function deleteVisitPhoto(photo: VisitPhoto): Promise<void> {
  await callEdge('gcs-sign', { action: 'delete', path: photo.photo_path });
  const { error } = await supabase.from('visit_photos').delete().eq('id', photo.id);
  if (error) throw error;
}

/**
 * Download a visit photo to the device's photo gallery.
 *
 * `downloadAsync` resolves for any HTTP status and writes the response body to
 * disk regardless, so an unchecked failure would "succeed" into the gallery as
 * an error document renamed .jpg. Check the status before saving.
 */
export async function downloadPhotoToGallery(photoUrl: string, filename: string): Promise<void> {
  // Ask for write-only access to images alone. The default call requests every
  // granular media permission including READ_MEDIA_AUDIO, which throws outright
  // on any build whose manifest doesn't declare it (Expo Go, older binaries) —
  // and this app never touches audio or video.
  const perm = await MediaLibrary.requestPermissionsAsync(true, ['photo']);
  if (!perm.granted) throw new Error('Photo library access is required to save images.');
  const localUri = `${cacheDirectory}${filename}`;
  const { uri, status } = await downloadAsync(photoUrl, localUri);
  if (status < 200 || status >= 300) {
    throw new Error(
      status === 404
        ? 'This photo is not in cloud storage. Photos logged before the move to Google Cloud Storage were not carried over.'
        : `Could not fetch the photo (HTTP ${status}). Try reopening the visit — view links expire after an hour.`
    );
  }
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

/**
 * Short-lived signed URLs to view uploaded visit photos. Batched, because a
 * visit usually has several and each one would otherwise be its own round trip.
 * Entries the caller isn't allowed to see come back as null.
 */
export async function getPhotoUrls(photoPaths: string[]): Promise<(string | null)[]> {
  const wanted = photoPaths.filter(Boolean);
  if (wanted.length === 0) return photoPaths.map(() => null);
  const { urls } = await callEdge<{ urls: (string | null)[] }>('gcs-sign', {
    action: 'read',
    paths: wanted,
  });
  const byPath = new Map(wanted.map((p, i) => [p, urls[i] ?? null]));
  return photoPaths.map((p) => (p ? byPath.get(p) ?? null : null));
}

/** Short-lived signed URL to view one uploaded visit photo. */
export async function getPhotoUrl(photoPath: string | null | undefined): Promise<string | null> {
  if (!photoPath) return null;
  const [url] = await getPhotoUrls([photoPath]);
  return url ?? null;
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
