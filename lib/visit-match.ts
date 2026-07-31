import { supabase } from './supabase';

export type MatchableVisit = {
  visitId: string;
  userLabel: string;
  placeLabel: string;
  submittedAt: string;
};

/**
 * Admin: every location_visit that plausibly used the given form — either an
 * area's own form override (assignments.form_id = formId), or a visit whose
 * area had no override and formId is the current global field form. Used to
 * build "verified" who/where/when columns in the Responses view, sourced
 * entirely from our own tamper-proof records instead of anything written into
 * the Google Form (see lib/visit-match.ts#matchVisitsToResponses).
 *
 * Note: uses the *current* global field form setting — if it was changed
 * since some of these visits were logged, older visits may be mismatched.
 * Acceptable trade-off for a single admin-managed setting that rarely changes.
 */
export async function listVisitsForForm(formId: string, sinceDays = 90): Promise<MatchableVisit[]> {
  const { data: settings, error: settingsErr } = await supabase
    .from('app_settings')
    .select('field_form_id')
    .eq('id', true)
    .single();
  if (settingsErr) throw settingsErr;
  const defaultFormId = settings?.field_form_id ?? null;

  const since = new Date();
  since.setDate(since.getDate() - sinceDays);

  const { data, error } = await supabase
    .from('location_visits')
    .select('id, user_id, place_label, submitted_at, assignment:assignments(form_id)')
    .gte('submitted_at', since.toISOString())
    .order('submitted_at', { ascending: true });
  if (error) throw error;

  const rows = (data ?? []).filter((r: any) => {
    const rowFormId = r.assignment?.form_id ?? null;
    return rowFormId ? rowFormId === formId : formId === defaultFormId;
  });

  const userIds = Array.from(new Set(rows.map((r: any) => r.user_id)));
  const labelById = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: profiles, error: profileErr } = await supabase
      .from('profiles')
      .select('id, display_name, email')
      .in('id', userIds);
    if (profileErr) throw profileErr;
    for (const p of profiles ?? []) labelById.set(p.id, p.display_name || p.email);
  }

  return rows.map((r: any) => ({
    visitId: r.id,
    userLabel: labelById.get(r.user_id) ?? 'Unknown',
    placeLabel: r.place_label,
    submittedAt: r.submitted_at,
  }));
}

/**
 * Greedily pairs each form response with the closest unclaimed visit whose
 * submitted_at is at or just before the response's submit time — mirrors the
 * real flow (log visit → form opens immediately → user fills & submits).
 * Pure function, no I/O, so it's easy to reason about/test independently of
 * the Supabase query above.
 */
export function matchVisitsToResponses(
  responses: { responseId: string; createTime?: string; lastSubmittedTime?: string }[],
  visits: MatchableVisit[]
): Map<string, MatchableVisit> {
  const MAX_AFTER_MS = 6 * 60 * 60 * 1000; // response up to 6h after the visit was logged
  const MAX_BEFORE_MS = 5 * 60 * 1000; // small clock-skew allowance the other way

  const sortedResponses = responses
    .map((r) => ({ r, t: new Date(r.createTime ?? r.lastSubmittedTime ?? '').getTime() }))
    .filter((x) => Number.isFinite(x.t) && x.t > 0)
    .sort((a, b) => a.t - b.t);

  const used = new Set<string>();
  const result = new Map<string, MatchableVisit>();

  for (const { r, t } of sortedResponses) {
    let best: MatchableVisit | null = null;
    let bestDiff = Infinity;
    for (const v of visits) {
      if (used.has(v.visitId)) continue;
      const diff = t - new Date(v.submittedAt).getTime();
      if (diff < -MAX_BEFORE_MS || diff > MAX_AFTER_MS) continue;
      if (diff < bestDiff) {
        bestDiff = diff;
        best = v;
      }
    }
    if (best) {
      used.add(best.visitId);
      result.set(r.responseId, best);
    }
  }

  return result;
}
