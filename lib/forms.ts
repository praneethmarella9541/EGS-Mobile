import { callEdge } from './edge';

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
  create(title: string): Promise<{ form: CreatedForm }> {
    return callEdge<{ form: CreatedForm }>('google-forms', { action: 'create', title });
  },

  /** Delete a Google Form + its mirror row (admin only). */
  remove(formId: string): Promise<{ ok: true }> {
    return callEdge<{ ok: true }>('google-forms', { action: 'delete', formId });
  },

  /** Resolve the public responder (fill) URL for a form. */
  async responderUri(formId: string): Promise<{ uri: string; shareWarning: string | null }> {
    const { form, shareWarning } = await callEdge<{
      form: Record<string, unknown>;
      shareWarning?: string | null;
    }>('google-forms', { action: 'get', formId });
    return { uri: String(form.responderUri ?? ''), shareWarning: shareWarning ?? null };
  },
};
