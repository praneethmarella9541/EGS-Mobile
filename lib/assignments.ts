import { supabase } from './supabase';
import type { Assignment, AssignmentWithVisits } from './types';

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

/** All assignments for a given date (admin view, every user), with any attached forms. */
export async function listAssignmentsForDate(dateKey: string): Promise<Assignment[]> {
  const { data, error } = await supabase
    .from('assignments')
    .select('*, forms:assignment_forms(*)')
    .eq('assigned_date', dateKey)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Fetch one assignment (with its attached forms) fresh — used when resolving which form(s) to open. */
export async function getAssignmentById(id: string): Promise<Assignment> {
  const { data, error } = await supabase
    .from('assignments')
    .select('*, forms:assignment_forms(*)')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

/**
 * Create one area assignment.
 * `forms`: undefined/null = not customized (falls back to the global default at
 * read time); an array (even empty) = the admin explicitly picked this set via
 * the multi-select — exactly these forms are attached, no fallback.
 */
export async function createAssignment(input: {
  userId: string;
  dateKey: string;
  areaLabel: string;
  forms?: { id: string; title: string; url: string }[] | null;
}): Promise<Assignment> {
  const { data: auth } = await supabase.auth.getUser();
  const customized = input.forms !== undefined && input.forms !== null;
  const { data, error } = await supabase
    .from('assignments')
    .insert({
      user_id: input.userId,
      assigned_date: input.dateKey,
      area_label: input.areaLabel.trim(),
      forms_customized: customized,
      created_by: auth.user?.id ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;

  if (customized && input.forms!.length > 0) {
    const { error: formsErr } = await supabase.from('assignment_forms').insert(
      input.forms!.map((f) => ({
        assignment_id: data.id,
        form_id: f.id,
        form_title: f.title,
        form_url: f.url,
      }))
    );
    if (formsErr) throw formsErr;
  }
  return data;
}

/** Create several area assignments for one user/date in one pass. */
export async function createAssignments(input: {
  userId: string;
  dateKey: string;
  items: { areaLabel: string; forms?: { id: string; title: string; url: string }[] | null }[];
}): Promise<{ created: number; failed: { areaLabel: string; error: string }[] }> {
  let created = 0;
  const failed: { areaLabel: string; error: string }[] = [];
  for (const item of input.items) {
    try {
      await createAssignment({
        userId: input.userId,
        dateKey: input.dateKey,
        areaLabel: item.areaLabel,
        forms: item.forms,
      });
      created += 1;
    } catch (e: any) {
      failed.push({ areaLabel: item.areaLabel, error: e?.message ?? 'Failed' });
    }
  }
  return { created, failed };
}

export async function deleteAssignment(id: string): Promise<void> {
  const { error } = await supabase.from('assignments').delete().eq('id', id);
  if (error) throw error;
}

/** The signed-in user's assignments for a date, joined with their logged visits. */
export async function listMyAssignments(dateKey: string): Promise<AssignmentWithVisits[]> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return [];

  const { data, error } = await supabase
    .from('assignments')
    .select('*, forms:assignment_forms(*), visits:location_visits(*, photos:visit_photos(*))')
    .eq('user_id', uid)
    .eq('assigned_date', dateKey)
    .order('created_at', { ascending: true });
  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    ...row,
    visits: (row.visits ?? []).sort(
      (a: any, b: any) => new Date(a.submitted_at).getTime() - new Date(b.submitted_at).getTime()
    ),
  }));
}
