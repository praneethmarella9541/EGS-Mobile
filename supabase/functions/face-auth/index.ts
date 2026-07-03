// Supabase Edge Function: face-auth
// Registers a user's face (as an embedding only — no photos are stored) and
// verifies check-in selfies against it, via the external PAL Face Service.
// Any authenticated user may call this for their own registration/verification
// (no admin check — unlike the other Edge Functions in this project).
//
// Deploy:  supabase functions deploy face-auth

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

const FACE_API_URL = 'https://face-api-429418881379.asia-south1.run.app';

function toBlob(base64: string): Blob {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: 'image/jpeg' });
}

async function getEmbedding(blob: Blob): Promise<number[]> {
  const form = new FormData();
  form.append('file', blob, 'photo.jpg');
  const res = await fetch(`${FACE_API_URL}/embedding`, { method: 'POST', body: form });
  const data = await res.json();
  if (!res.ok || !Array.isArray(data.embedding)) {
    throw new Error('Face not detected — please retake in good lighting.');
  }
  return data.embedding as number[];
}

async function compare(
  blob: Blob,
  candidates: [string, number[]][]
): Promise<{ match: boolean; best_id: string; similarity: number; threshold: number }> {
  const form = new FormData();
  form.append('file', blob, 'photo.jpg');
  form.append('embeddings_json', JSON.stringify(candidates));
  const res = await fetch(`${FACE_API_URL}/compare`, { method: 'POST', body: form });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Face comparison failed.');
  return data;
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

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let body: {
    action?: string;
    photo1Base64?: string;
    photo2Base64?: string;
    photoBase64?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  try {
    switch (body.action) {
      case 'register': {
        if (!body.photo1Base64 || !body.photo2Base64) {
          return json({ error: 'photo1Base64 and photo2Base64 required' }, 400);
        }
        const embedding = await getEmbedding(toBlob(body.photo1Base64));
        const result = await compare(toBlob(body.photo2Base64), [[uid, embedding]]);

        if (!result.match) {
          // Quality gate failed — nothing is persisted, client just retries.
          return json({ ok: false, similarity: result.similarity, threshold: result.threshold });
        }

        const { error: upsertErr } = await admin
          .from('face_embeddings')
          .upsert({ user_id: uid, embedding, registered_at: new Date().toISOString() });
        if (upsertErr) throw upsertErr;

        const { error: profileErr } = await admin
          .from('profiles')
          .update({ face_registered: true })
          .eq('id', uid);
        if (profileErr) throw profileErr;

        return json({ ok: true, similarity: result.similarity, threshold: result.threshold });
      }

      case 'verify': {
        if (!body.photoBase64) return json({ error: 'photoBase64 required' }, 400);

        const { data: row } = await admin
          .from('face_embeddings')
          .select('embedding')
          .eq('user_id', uid)
          .maybeSingle();
        if (!row) return json({ error: 'Face not registered' }, 400);

        const result = await compare(toBlob(body.photoBase64), [[uid, row.embedding as number[]]]);
        const verified = result.match && result.best_id === uid;
        return json({ verified, similarity: result.similarity, threshold: result.threshold });
      }

      default:
        return json({ error: 'Unknown action' }, 400);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Server error' }, 500);
  }
});
