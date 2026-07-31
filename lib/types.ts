/** Two roles only: admin (full access) and user (feature-restricted). */
export type UserRole = 'admin' | 'user';

export interface Profile {
  id: string;
  email: string;
  display_name: string | null;
  role: UserRole;
  /** Feature keys a normal user is NOT allowed to access. Ignored for admins. */
  restricted_features: string[];
  mobile_phone: string | null;
  /** Has this (non-admin) user completed face registration? Always true for admins. */
  face_registered: boolean;
}

/**
 * Acceptable distance (metres) between a user's live GPS and the address they
 * typed/picked for a location visit — logging a visit is blocked outside this.
 */
export const GEO_RADIUS_M = 200;

/**
 * Face registration + check-in face verification are wired but disabled for now
 * (Cloud Run face-api cold starts were making check-in too slow). Flip this back
 * to true to re-enable — everything else (schema, edge function, face-registration
 * screen) is already in place, untouched. Re-enabling will need to be re-wired
 * into location_visits (see lib/visits.ts) since the old per-assignment
 * check-in flow it was built against no longer exists.
 */
export const FACE_VERIFICATION_ENABLED = false;

/** An admin-assigned area for a user on a given date — a free-text label, no pin. */
export interface Assignment {
  id: string;
  user_id: string;
  assigned_date: string; // YYYY-MM-DD
  area_label: string; // e.g. "Sector 4-7, Gurgaon" — admin-typed, no geocoding
  /** Optional override of the global field form for this area. Null = use the default. */
  form_id: string | null;
  form_url: string | null;
  created_by: string;
  created_at: string;
}

/** One photo attached to a location visit. */
export interface VisitPhoto {
  id: string;
  visit_id: string;
  photo_path: string;
}

/**
 * A user-logged visit to a specific place within their assigned area — the
 * user types/picks the address, and must be within GEO_RADIUS_M of it (their
 * live GPS vs the picked address) to log it. N per assignment per day
 * (unlimited, user-driven).
 */
export interface LocationVisit {
  id: string;
  assignment_id: string;
  user_id: string;
  place_label: string; // address the user typed/picked
  latitude: number; // device's live GPS at submit time
  longitude: number;
  distance_m: number; // distance between live GPS and the picked address
  notes: string;
  submitted_at: string;
  photos: VisitPhoto[];
}

/** Assignment joined with its visits so far — used on the user task screen. */
export interface AssignmentWithVisits extends Assignment {
  visits: LocationVisit[];
}

/** Assignment joined with visits + the assignee's profile — admin Attendance tab. */
export interface AdminAssignmentRow extends Assignment {
  visits: LocationVisit[];
  profile: { display_name: string | null; email: string } | null;
}
