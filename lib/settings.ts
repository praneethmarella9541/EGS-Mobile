import { supabase } from './supabase';
import type { Assignment } from './types';

/**
 * The single Google Form used for every area, every user, every day. Admin
 * designates it from the Forms tab; field users open it after logging a visit.
 */
export async function getFieldForm(): Promise<{ id: string; url: string } | null> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('field_form_id, field_form_url')
    .eq('id', true)
    .single();
  if (error) throw error;
  return data?.field_form_url && data.field_form_id
    ? { id: data.field_form_id, url: data.field_form_url }
    : null;
}

export async function setFieldForm(formId: string, url: string): Promise<void> {
  const { error } = await supabase
    .from('app_settings')
    .update({ field_form_id: formId, field_form_url: url })
    .eq('id', true);
  if (error) throw error;
}

/** The form to use for an area: its own override if the admin set one, else the global default. */
export async function resolveAssignmentForm(
  assignment: Pick<Assignment, 'form_id' | 'form_url'>
): Promise<{ id: string; url: string } | null> {
  if (assignment.form_id && assignment.form_url) {
    return { id: assignment.form_id, url: assignment.form_url };
  }
  return getFieldForm();
}

/**
 * Whether the Forms tab's Responses view should show verified who/where/when
 * details next to each response (matched from the app's own location_visits,
 * see lib/visit-match.ts) — not anything written into the Google Form itself.
 * Admin toggle, shown on the Forms tab.
 */
export async function getIncludeVisitContext(): Promise<boolean> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('include_visit_context')
    .eq('id', true)
    .single();
  if (error) throw error;
  return !!data?.include_visit_context;
}

export async function setIncludeVisitContext(value: boolean): Promise<void> {
  const { error } = await supabase.from('app_settings').update({ include_visit_context: value }).eq('id', true);
  if (error) throw error;
}
