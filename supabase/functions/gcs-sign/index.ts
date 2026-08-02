// Supabase Edge Function: gcs-sign
// Brokers access to the private GCS bucket that holds visit photos. The app has
// no Google credential, so it asks here for short-lived V4 signed URLs.
//
// This function is where photo authorization now lives. It reproduces the rules
// the old Supabase Storage policies enforced:
//   upload — only onto a visit the caller owns, at a path the server chooses
//   read   — the caller's own photos, or anything if the caller is an admin
//   delete — the caller's own photos only
//
// Deploy:  supabase functions deploy gcs-sign
// Secrets: GCS_SA_KEY, GCS_BUCKET (see _shared/gcs.ts). SUPABASE_URL,
//          SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY are injected.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { signedUrl, deleteObject } from '../_shared/gcs.ts';

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

/** How long a view URL stays valid — matches the old createSignedUrl(…, 3600). */
const READ_TTL = 3600;
/** Uploads are used immediately; keep the window tight. */
const UPLOAD_TTL = 600;

/** Photos live at <uid>/<visitId>/<n>-<ts>.jpg — the first segment is the owner. */
function ownerOf(path: string): string {
  return path.split('/')[0] ?? '';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Missing token' }, 401);

  const callerClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userData.user) return json({ error: 'Invalid session' }, 401);
  const uid = userData.user.id;

  let body: {
    action?: string;
    visitId?: string;
    count?: number;
    paths?: string[];
    path?: string;
    filename?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  try {
    switch (body.action) {
      // Signed PUT URLs for a batch of photos on one visit. The server picks the
      // object paths so a caller can't write outside their own folder.
      case 'upload': {
        const { visitId, count } = body;
        if (!visitId || !count || count < 1) {
          return json({ error: 'visitId and count are required' }, 400);
        }
        if (count > 20) return json({ error: 'Too many photos in one request' }, 400);

        const { data: visit, error } = await callerClient
          .from('location_visits')
          .select('id, user_id')
          .eq('id', visitId)
          .single();
        if (error || !visit) return json({ error: 'Visit not found' }, 404);
        if (visit.user_id !== uid) return json({ error: 'Not your visit' }, 403);

        const stamp = Date.now();
        const uploads = await Promise.all(
          Array.from({ length: count }, async (_, i) => {
            const path = `${uid}/${visitId}/${i}-${stamp}.jpg`;
            return { path, url: await signedUrl('PUT', path, UPLOAD_TTL) };
          })
        );
        return json({ uploads });
      }

      // Signed GET URLs. Admins may read any photo (the admin dashboard shows
      // every field user's visits); everyone else only their own.
      case 'read': {
        const paths = body.paths ?? (body.path ? [body.path] : []);
        if (paths.length === 0) return json({ error: 'paths are required' }, 400);
        if (paths.length > 100) return json({ error: 'Too many paths in one request' }, 400);

        let isAdmin = false;
        if (paths.some((p) => ownerOf(p) !== uid)) {
          const { data: profile } = await callerClient
            .from('profiles')
            .select('role')
            .eq('id', uid)
            .single();
          isAdmin = profile?.role === 'admin';
        }

        const urls = await Promise.all(
          paths.map(async (p) =>
            ownerOf(p) === uid || isAdmin ? await signedUrl('GET', p, READ_TTL) : null
          )
        );
        return json({ urls });
      }

      // A signed GET URL that forces a browser download instead of rendering
      // inline, for the admin console's download button. Same read rule as
      // 'read' (owner or admin) — kept separate so the plain view URLs used in
      // <img> tags stay renderable rather than always downloading.
      case 'download': {
        const { path, filename } = body;
        if (!path) return json({ error: 'path is required' }, 400);

        let isAdmin = false;
        if (ownerOf(path) !== uid) {
          const { data: profile } = await callerClient
            .from('profiles')
            .select('role')
            .eq('id', uid)
            .single();
          isAdmin = profile?.role === 'admin';
        }
        if (ownerOf(path) !== uid && !isAdmin) return json({ error: 'Not authorized' }, 403);

        const safeName = (filename || path.split('/').pop() || 'photo.jpg').replace(/"/g, "'");
        const url = await signedUrl('GET', path, READ_TTL, {
          'response-content-disposition': `attachment; filename="${safeName}"`,
        });
        return json({ url });
      }

      // Deleting a photo is only ever done by its owner, from the visit editor.
      case 'delete': {
        if (!body.path) return json({ error: 'path is required' }, 400);
        if (ownerOf(body.path) !== uid) return json({ error: 'Not your photo' }, 403);
        await deleteObject(body.path);
        return json({ ok: true });
      }

      default:
        return json({ error: 'Unknown action' }, 400);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Server error' }, 500);
  }
});
