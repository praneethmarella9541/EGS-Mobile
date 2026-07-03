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

/** Acceptable distance (metres) for geo-verification. */
export const GEO_RADIUS_M = 250;

/**
 * Face registration + check-in face verification are wired but disabled for now
 * (Cloud Run face-api cold starts were making check-in too slow). Flip this back
 * to true to re-enable — everything else (schema, edge function, face-registration
 * screen) is already in place, untouched.
 */
export const FACE_VERIFICATION_ENABLED = false;

/** An admin-created task for a user on a given date: visit a location, fill a form. */
export interface Assignment {
  id: string;
  user_id: string;
  assigned_date: string; // YYYY-MM-DD
  location_label: string; // address the admin typed
  latitude: number;
  longitude: number;
  form_url: string;
  created_by: string;
  created_at: string;
}

/** A user's completed attendance for one assignment. */
export interface Attendance {
  id: string;
  assignment_id: string;
  user_id: string;
  photo_path: string | null;
  captured_lat: number;
  captured_lng: number;
  distance_m: number;
  verified: boolean;
  face_similarity: number | null;
  submitted_at: string;
}

/** Assignment joined with its attendance (if any) — used on the user task screen. */
export interface AssignmentWithStatus extends Assignment {
  attendance: Attendance | null;
}

/** Assignment joined with attendance + the assignee's profile — admin Attendance tab. */
export interface AdminAttendanceRow extends Assignment {
  attendance: Attendance | null;
  profile: { display_name: string | null; email: string } | null;
}
