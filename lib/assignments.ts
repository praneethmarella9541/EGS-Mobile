import { supabase } from './supabase';
import { geocodeAddress } from './geo';
import type { Assignment, AssignmentWithStatus } from './types';

export interface AssignableUser {
  id: string;
  email: string;
  display_name: string | null;
}

/** Format a Date as YYYY-MM-DD in local time (for assigned_date). */
export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Users (role 'user') an admin can assign work to. */
export async function listAssignableUsers(): Promise<AssignableUser[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, display_name')
    .eq('role', 'user')
    .order('display_name', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** All assignments for a given date (admin view, every user). */
export async function listAssignmentsForDate(dateKey: string): Promise<Assignment[]> {
  const { data, error } = await supabase
    .from('assignments')
    .select('*')
    .eq('assigned_date', dateKey)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Create one assignment. Geocodes the address before saving. */
export async function createAssignment(input: {
  userId: string;
  dateKey: string;
  address: string;
  formUrl: string;
}): Promise<Assignment> {
  const { lat, lng } = await geocodeAddress(input.address);
  const { data: auth } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('assignments')
    .insert({
      user_id: input.userId,
      assigned_date: input.dateKey,
      location_label: input.address.trim(),
      latitude: lat,
      longitude: lng,
      form_url: input.formUrl.trim(),
      created_by: auth.user?.id ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

/** Create several assignments for one user/date in one pass (geocodes each). */
export async function createAssignments(input: {
  userId: string;
  dateKey: string;
  items: { address: string; formUrl: string }[];
}): Promise<{ created: number; failed: { address: string; error: string }[] }> {
  let created = 0;
  const failed: { address: string; error: string }[] = [];
  for (const item of input.items) {
    try {
      await createAssignment({
        userId: input.userId,
        dateKey: input.dateKey,
        address: item.address,
        formUrl: item.formUrl,
      });
      created += 1;
    } catch (e: any) {
      failed.push({ address: item.address, error: e?.message ?? 'Failed' });
    }
  }
  return { created, failed };
}

export async function deleteAssignment(id: string): Promise<void> {
  const { error } = await supabase.from('assignments').delete().eq('id', id);
  if (error) throw error;
}

/** The signed-in user's assignments for a date, joined with their attendance. */
export async function listMyAssignments(dateKey: string): Promise<AssignmentWithStatus[]> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return [];

  const { data, error } = await supabase
    .from('assignments')
    .select('*, attendance:attendance(*)')
    .eq('user_id', uid)
    .eq('assigned_date', dateKey)
    .order('created_at', { ascending: true });
  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    ...row,
    attendance: Array.isArray(row.attendance) ? (row.attendance[0] ?? null) : (row.attendance ?? null),
  }));
}
