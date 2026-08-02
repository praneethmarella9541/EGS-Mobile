import { callEdge } from './edge';
import { supabase } from './supabase';

/** A form as listed from the admin's Google Drive. */
export interface FormListItem {
  id: string;
  title: string;
  modifiedTime?: string;
}

/** Full row returned by the create action (mirrors public.forms). */
export interface CreatedForm {
  id: string;
  title: string;
  responder_uri: string;
  edit_uri: string | null;
}

export const forms = {
  /** Every Google Form in the admin's Drive. */
  async list(): Promise<FormListItem[]> {
    const { forms } = await callEdge<{ forms: FormListItem[] }>('google-forms', { action: 'list' });
    return forms;
  },

  /** Create a new Google Form (admin only). */
  create(title: string): Promise<{ form: CreatedForm; titleWarning?: string | null }> {
    return callEdge<{ form: CreatedForm; titleWarning?: string | null }>('google-forms', {
      action: 'create',
      title,
    });
  },

  /** Delete a Google Form + its mirror row (admin only). */
  remove(formId: string): Promise<{ ok: true }> {
    return callEdge<{ ok: true }>('google-forms', { action: 'delete', formId });
  },

  /**
   * Public responder URLs already stored in public.forms (app-created forms),
   * keyed by form id. A single Supabase read — no Google round-trip — so
   * copy-link is instant for these forms. Falls back to responderUri() for
   * forms not mirrored here (e.g. imported ones).
   */
  async cachedResponderUris(): Promise<Record<string, string>> {
    const { data } = await supabase.from('forms').select('id, responder_uri');
    const map: Record<string, string> = {};
    for (const row of data ?? []) {
      if (row.responder_uri) map[row.id as string] = row.responder_uri as string;
    }
    return map;
  },

  /**
   * Resolve the public responder (fill) URL for a form, and make it openable by
   * field users with no Google login (forResponders → relax verified email
   * collection + ensure link sharing).
   */
  async responderUri(formId: string): Promise<{ uri: string; shareWarning: string | null }> {
    const { form, shareWarning } = await callEdge<{
      form: Record<string, unknown>;
      shareWarning?: string | null;
    }>('google-forms', { action: 'get', formId, forResponders: true });
    return { uri: String(form.responderUri ?? ''), shareWarning: shareWarning ?? null };
  },
};
