// Supabase Edge Function: google-forms
// Admin creates/deletes Google Forms. Uses the admin's stored refresh token to
// mint a short-lived Google access token, calls the Forms/Drive API, and mirrors
// the form into public.forms.
//
// Requires secrets:  GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
// Deploy:  supabase functions deploy google-forms

import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

// Google access tokens live ~1h. Refreshing one on EVERY action added a full
// round-trip to oauth2.googleapis.com before any real work. Cache them per
// refresh token (module scope survives while the isolate stays warm), so bursts
// of actions — editing a form, assigning several forms — reuse one token.
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function googleAccessToken(refreshToken: string): Promise<string> {
  const cached = tokenCache.get(refreshToken);
  // 60s skew so we never hand back an about-to-expire token.
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: Deno.env.get('GOOGLE_CLIENT_ID')!,
      client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || 'Could not refresh Google token');
  }
  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600;
  tokenCache.set(refreshToken, {
    token: data.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
  });
  return data.access_token as string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Missing token' }, 401);

  const callerClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userData.user) return json({ error: 'Invalid session' }, 401);
  const uid = userData.user.id;

  const { data: profile } = await callerClient
    .from('profiles')
    .select('role')
    .eq('id', uid)
    .single();
  if (profile?.role !== 'admin') return json({ error: 'Admin access required' }, 403);

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // The Google refresh token belongs to whoever connected Google. Use this
  // admin's if present, else any stored admin credential (shared workspace).
  const { data: cred } = await admin
    .from('google_credentials')
    .select('refresh_token')
    .eq('user_id', uid)
    .maybeSingle();
  let refreshToken = cred?.refresh_token as string | undefined;
  if (!refreshToken) {
    // Fall back to ANY stored admin Google credential. The workspace connects a
    // single Google account that owns/creates the forms, so any admin's token
    // can manage and (re)share them — this admin just hasn't connected their own.
    // Keeps forms working for every admin (and, via public sharing, every field
    // user) off one shared Google connection.
    const { data: anyCred } = await admin
      .from('google_credentials')
      .select('refresh_token')
      .not('refresh_token', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    refreshToken = anyCred?.refresh_token as string | undefined;
  }
  if (!refreshToken) {
    return json(
      { error: 'Google not connected. Ask an admin to sign in with Google (granting Forms + Drive access) at least once.' },
      400
    );
  }

  let body: {
    action?: string;
    title?: string;
    formId?: string;
    requests?: unknown[];
    writeControl?: unknown;
    pageToken?: string;
    pageSize?: number;
    // 'get' only: also make the form openable by field users with no Google
    // login (downgrade "verified email collection", which forces sign-in).
    forResponders?: boolean;
    // 'get' only: fetch the form and return immediately, skipping the
    // share / filename-heal / email side-effects (used by save's diff fetch).
    bare?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const formUrl = (id: string) => `https://forms.googleapis.com/v1/forms/${encodeURIComponent(id)}`;

  // Newly-created (and pre-existing) Drive files — forms and their linked
  // response spreadsheets — are private to the admin by default, which makes
  // Google prompt field users/admins to sign in before they can view them in
  // an in-app WebView. Neither shares the admin's Google account, so instead
  // we make the file link-shareable — anyone with the link can open it
  // without signing in. Best-effort: a failure here (e.g. missing Drive
  // scope) doesn't block the caller; get/create retries sharing next call.
  async function ensurePubliclyShared(fileId: string, token: string): Promise<string | null> {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'reader', type: 'anyone' }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const message = err.error?.message || `HTTP ${res.status}`;
      console.error(`Failed to share ${fileId}:`, message);
      return message;
    }
    return null;
  }

  // The Drive filename (shown in the Forms home screen, Drive, and the
  // editor's top-left) is a Drive property, NOT the Forms API's
  // info.documentTitle — updateFormInfo accepts documentTitle in the request
  // and returns 200 but silently no-ops it. Renaming the Drive file directly
  // is the only thing that actually works.
  async function renameDriveFile(fileId: string, name: string, token: string): Promise<string | null> {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const message = err.error?.message || `HTTP ${res.status}`;
      console.error(`Failed to rename ${fileId}:`, message);
      return message;
    }
    return null;
  }

  try {
    const accessToken = await googleAccessToken(refreshToken);
    const gHeaders = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    };

    switch (body.action) {
      case 'create': {
        const title = (body.title ?? '').trim() || 'Untitled form';
        const res = await fetch('https://forms.googleapis.com/v1/forms', {
          method: 'POST',
          headers: gHeaders,
          // forms.create only honors info.title — the Drive filename (what the
          // Forms home screen/list shows) is a separate Drive property and
          // must be set via the Drive API below, or every form shows up as
          // "Untitled form" there despite having the right on-page title.
          body: JSON.stringify({ info: { title } }),
        });
        const form = await res.json();
        if (!res.ok) throw new Error(form.error?.message || 'Failed to create form');

        const responderUri: string = form.responderUri;
        const editUri = `https://docs.google.com/forms/d/${form.formId}/edit`;

        // Only the DB mirror row is needed before returning. The Drive filename
        // rename and public link-share are deferred to the editor's first get()
        // (the app opens the editor right after create) — skipping them here
        // makes create return in one Google round-trip instead of three.
        const { data: row, error: insErr } = await admin
          .from('forms')
          .insert({
            id: form.formId,
            title,
            responder_uri: responderUri,
            edit_uri: editUri,
            created_by: uid,
          })
          .select('*')
          .single();
        if (insErr) throw insErr;
        return json({ form: row, titleWarning: null });
      }

      case 'list': {
        // Every Google Form in the admin's Drive (not just app-created ones).
        const q = "mimeType='application/vnd.google-apps.form' and trashed=false";
        const driveUrl =
          `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}` +
          `&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc&pageSize=200`;
        const res = await fetch(driveUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Failed to list forms');
        const list = (data.files ?? []).map((f: any) => ({
          id: f.id,
          title: f.name,
          modifiedTime: f.modifiedTime,
        }));
        return json({ forms: list });
      }

      case 'get': {
        if (!body.formId) return json({ error: 'formId required' }, 400);
        const formId = body.formId;
        const res = await fetch(formUrl(formId), { headers: gHeaders });
        const form = await res.json();
        if (!res.ok) throw new Error(form.error?.message || 'Failed to load form');

        // Diff-only fetch (save): skip every side-effect, just return the form.
        if (body.bare) return json({ form });

        // The post-fetch steps below touch independent Google resources (Drive
        // file name, Drive permissions, Forms settings), so run them CONCURRENTLY.
        // They used to run one-after-another, which is what made setting the
        // field form slow — total latency was the SUM of every round-trip; now
        // it's roughly the slowest single call.

        // 1) Self-heal the Drive filename to match the form title (the Forms
        //    API's info.documentTitle is unreliable, so rename the file directly).
        const titleTask = (async (): Promise<string | null> => {
          if (!form.info?.title) return null;
          const driveRes = await fetch(
            `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(formId)}?fields=name`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
          const driveFile = await driveRes.json().catch(() => ({}));
          if (driveRes.ok && driveFile.name !== form.info.title) {
            return renameDriveFile(formId, form.info.title, accessToken);
          }
          return null;
        })();

        // 2) Link-share the form (and its linked response sheet) so it opens
        //    without sign-in.
        const shareTask = ensurePubliclyShared(formId, accessToken);
        const sheetShareTask =
          typeof form.linkedSheetId === 'string'
            ? ensurePubliclyShared(form.linkedSheetId, accessToken)
            : Promise.resolve(null);

        // 3) When handing the form to field users (forResponders), relax
        //    "verified" email collection — it forces a Google sign-in, and field
        //    users have no login of their own. Downgrade to "responder input"
        //    (still collects an email, typed, no sign-in). Editor 'get' calls
        //    omit forResponders, so the admin's chosen setting is never stripped.
        //    ("Limit to 1 response" also forces sign-in but isn't exposed by the
        //    Forms API — the admin must turn that off in the form itself.)
        const loginFixTask = (async (): Promise<string | null> => {
          if (!(body.forResponders && form?.settings?.emailCollectionType === 'VERIFIED')) {
            return null;
          }
          const upd = await fetch(`${formUrl(formId)}:batchUpdate`, {
            method: 'POST',
            headers: gHeaders,
            body: JSON.stringify({
              requests: [
                {
                  updateSettings: {
                    settings: { emailCollectionType: 'RESPONDER_INPUT' },
                    updateMask: 'emailCollectionType',
                  },
                },
              ],
            }),
          });
          if (!upd.ok) {
            const e = await upd.json().catch(() => ({}));
            const msg = e.error?.message || `HTTP ${upd.status}`;
            console.error(`Failed to relax email collection on ${formId}:`, msg);
            return msg;
          }
          if (form.settings) form.settings.emailCollectionType = 'RESPONDER_INPUT';
          return null;
        })();

        const [titleWarning, shareWarning, , loginFixWarning] = await Promise.all([
          titleTask,
          shareTask,
          sheetShareTask,
          loginFixTask,
        ]);

        return json({ form, shareWarning, titleWarning, loginFixWarning });
      }

      case 'batchUpdate': {
        if (!body.formId) return json({ error: 'formId required' }, 400);
        const res = await fetch(`${formUrl(body.formId)}:batchUpdate`, {
          method: 'POST',
          headers: gHeaders,
          body: JSON.stringify({
            requests: body.requests ?? [],
            writeControl: body.writeControl,
            includeFormInResponse: true,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Failed to save form');
        let form = data.form;
        if (!form) {
          const g = await fetch(formUrl(body.formId), { headers: gHeaders });
          form = await g.json();
        }
        return json({ form });
      }

      case 'responses': {
        if (!body.formId) return json({ error: 'formId required' }, 400);
        const params = new URLSearchParams();
        if (body.pageToken) params.set('pageToken', body.pageToken);
        params.set('pageSize', String(body.pageSize ?? 50));
        const res = await fetch(`${formUrl(body.formId)}/responses?${params.toString()}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Failed to load responses');
        return json({ responses: data.responses ?? [], nextPageToken: data.nextPageToken });
      }

      case 'delete': {
        if (!body.formId) return json({ error: 'formId required' }, 400);
        // Forms are Drive files. The Drive delete and dropping our mirror row are
        // independent — run them concurrently.
        const [res] = await Promise.all([
          fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(body.formId)}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${accessToken}` },
          }),
          admin.from('forms').delete().eq('id', body.formId),
        ]);
        // 404 = already gone; treat as success.
        if (!res.ok && res.status !== 404) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error?.message || 'Failed to delete form');
        }
        return json({ ok: true });
      }

      default:
        return json({ error: 'Unknown action' }, 400);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Server error' }, 500);
  }
});
