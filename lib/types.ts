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
 * Acceptable distance (metres) between a user's live GPS and the place they
 * picked for a location visit — logging a visit is blocked outside this.
 *
 * Since the place is normally derived *from* the GPS fix (see PlaceSource), this
 * is usually near-zero at pick time. It still earns its keep at submit time: the
 * GPS is re-read on "Log visit", so this catches a user who fetches at the
 * school and then submits from somewhere else.
 */
export const GEO_RADIUS_M = 200;

/**
 * Worst GPS accuracy (metres) we'll build a nearby-places list from. Beyond
 * this the fix is too loose to say which building the user is standing in —
 * common indoors — so we ask them to move and retry instead of offering a list
 * of the wrong places.
 */
export const GPS_ACCURACY_MAX_M = 100;

/** Above this we still allow the visit but warn the user the list may be off. */
export const GPS_ACCURACY_WARN_M = 50;

/**
 * How the place on a visit was obtained. Coordinates are machine-captured in
 * every case — this records how much the *user* steered the choice, which is
 * the admin's scrutiny signal now that distance_m is near-zero by construction.
 */
export type PlaceSource = 'nearby' | 'reverse_geocode' | 'manual_search';

/**
 * Face registration + check-in face verification are wired but disabled for now
 * (Cloud Run face-api cold starts were making check-in too slow). Flip this back
 * to true to re-enable — everything else (schema, edge function, face-registration
 * screen) is already in place, untouched. Re-enabling will need to be re-wired
 * into location_visits (see lib/visits.ts) since the old per-assignment
 * check-in flow it was built against no longer exists.
 */
export const FACE_VERIFICATION_ENABLED = false;

/** One Google Form explicitly attached to an area assignment (see AssignmentForm below). */
export interface AssignmentForm {
  id: string;
  assignment_id: string;
  form_id: string;
  form_title: string;
  form_url: string;
  created_at: string;
}

/** An admin-assigned area for a user on a given date — a free-text label, no pin. */
export interface Assignment {
  id: string;
  user_id: string;
  assigned_date: string; // YYYY-MM-DD
  area_label: string; // e.g. "Sector 4-7, Gurgaon" — admin-typed, no geocoding
  /** Legacy single-form override of the global field form. Null = use the default.
   *  Superseded by `forms` below when forms_customized is true. */
  form_id: string | null;
  form_url: string | null;
  /** True once an admin has explicitly picked a form set via the multi-select —
   *  at that point `forms` is authoritative (even if empty), no fallback. */
  forms_customized: boolean;
  /** Explicitly attached forms (only meaningful when forms_customized is true).
   *  Present when the query embeds assignment_forms; absent otherwise. */
  forms?: AssignmentForm[];
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
 * A user-logged visit to a specific place within their assigned area. The place
 * is captured from the device's live GPS (nearby buildings/schools around the
 * user), so the coordinates are never user-supplied — only the label can be
 * edited. The user must still be within GEO_RADIUS_M of it at submit time. N per
 * assignment per day (unlimited, user-driven).
 */
export interface LocationVisit {
  id: string;
  assignment_id: string;
  user_id: string;
  place_label: string; // name/address of the place visited
  latitude: number; // device's live GPS at submit time
  longitude: number;
  distance_m: number; // distance between live GPS and the picked place
  notes: string;
  submitted_at: string;
  /** Google place_id of the picked place; null for reverse-geocoded addresses. */
  place_id: string | null;
  /** Null on visits logged before the GPS-first flow existed. */
  place_source: PlaceSource | null;
  /** User typed over the fetched name — coordinates are unaffected. */
  label_edited: boolean;
  gps_accuracy_m: number | null;
  /** When the location was fetched; gap to submitted_at is a tamper signal. */
  fetched_at: string | null;
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
