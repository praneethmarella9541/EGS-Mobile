import { callEdge } from './edge';
import { buildBatchUpdateRequests, type EditorState } from './google-forms-editor-model';
import type { FormResponse } from './form-responses';

type GoogleForm = Record<string, unknown>;

export interface SaveResult {
  ok: boolean;
  form?: GoogleForm;
  editorState?: unknown;
  noChanges?: boolean;
  error?: string;
  message?: string;
}

/**
 * Mirrors Placecom's server-backed `formsApi`, but the heavy lifting runs here:
 * the client builds the Google Forms batchUpdate requests from the editor state
 * (via buildBatchUpdateRequests) and the google-forms Edge Function just relays
 * them to Google. get/responses are thin pass-throughs.
 */
export const formsApi = {
  async get(formId: string, opts?: { bare?: boolean }): Promise<GoogleForm> {
    const { form } = await callEdge<{ form: GoogleForm }>('google-forms', {
      action: 'get',
      formId,
      // bare = skip the share / filename / email side-effects (just fetch).
      bare: opts?.bare,
    });
    return form;
  },

  /**
   * Like get(), but also surfaces whether Google refused to make the file
   * link-shareable, or refused to fix the Drive filename (documentTitle).
   */
  async getWithShareStatus(
    formId: string
  ): Promise<{ form: GoogleForm; shareWarning: string | null; titleWarning: string | null }> {
    const { form, shareWarning, titleWarning } = await callEdge<{
      form: GoogleForm;
      shareWarning?: string | null;
      titleWarning?: string | null;
    }>('google-forms', { action: 'get', formId });
    return { form, shareWarning: shareWarning ?? null, titleWarning: titleWarning ?? null };
  },

  async save(formId: string, state: EditorState): Promise<SaveResult> {
    // Only need the current form to diff against — skip share/filename side-effects.
    const prev = await formsApi.get(formId, { bare: true });
    const { requests, writeControl } = buildBatchUpdateRequests(prev, state);
    if (requests.length === 0) return { ok: true, noChanges: true, form: prev };
    const { form } = await callEdge<{ form: GoogleForm }>('google-forms', {
      action: 'batchUpdate',
      formId,
      requests,
      writeControl,
    });
    return { ok: true, form };
  },

  responses(
    formId: string,
    opts?: { pageToken?: string; pageSize?: number }
  ): Promise<{ responses: FormResponse[]; nextPageToken?: string }> {
    return callEdge('google-forms', {
      action: 'responses',
      formId,
      pageToken: opts?.pageToken,
      pageSize: opts?.pageSize ?? 50,
    });
  },
};
