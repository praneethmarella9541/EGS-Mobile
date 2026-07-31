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

async function googleAccessToken(refreshToken: string): Promise<string> {
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
  const refreshToken = cred?.refresh_token;
  if (!refreshToken) {
    return json(
      { error: 'Google not connected. Sign out and sign in with Google again to grant Forms access.' },
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

        const titleWarning = await renameDriveFile(form.formId, title, accessToken);

        await ensurePubliclyShared(form.formId, accessToken);

        const responderUri: string = form.responderUri;
        const editUri = `https://docs.google.com/forms/d/${form.formId}/edit`;
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
        return json({ form: row, titleWarning });
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
        const res = await fetch(formUrl(body.formId), { headers: gHeaders });
        const form = await res.json();
        if (!res.ok) throw new Error(form.error?.message || 'Failed to load form');

        // Self-heal forms whose Drive filename never got set to match the form's
        // title (e.g. created before this fix) — check the real Drive name
        // (info.documentTitle from the Forms API is unreliable/not kept in
        // sync) and rename the file directly if it doesn't match.
        let titleWarning: string | null = null;
        if (form.info?.title) {
          const driveRes = await fetch(
            `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(body.formId)}?fields=name`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
          const driveFile = await driveRes.json().catch(() => ({}));
          if (driveRes.ok && driveFile.name !== form.info.title) {
            titleWarning = await renameDriveFile(body.formId, form.info.title, accessToken);
          }
        }

        const shareWarning = await ensurePubliclyShared(body.formId, accessToken);
        if (typeof form.linkedSheetId === 'string') {
          await ensurePubliclyShared(form.linkedSheetId, accessToken);
        }
        return json({ form, shareWarning, titleWarning });
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
        // Forms are Drive files — delete via Drive, then drop our mirror row.
        const res = await fetch(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(body.formId)}`,
          { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } }
        );
        // 404 = already gone; treat as success.
        if (!res.ok && res.status !== 404) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error?.message || 'Failed to delete form');
        }
        await admin.from('forms').delete().eq('id', body.formId);
        return json({ ok: true });
      }

      default:
        return json({ error: 'Unknown action' }, 400);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Server error' }, 500);
  }
});
