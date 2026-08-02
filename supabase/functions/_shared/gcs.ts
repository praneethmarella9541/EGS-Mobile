// Google Cloud Storage helpers for Edge Functions (Deno).
//
// Visit photos live in a private GCS bucket. Neither the app nor the browser
// ever holds a Google credential — Edge Functions hold the service-account key
// and hand out short-lived V4 signed URLs instead.
//
// Secrets (set once in the Supabase dashboard → Edge Functions → Secrets):
//   GCS_SA_KEY  — the full service-account JSON, pasted verbatim
//   GCS_BUCKET  — the bucket name, e.g. nucleus-visit-photos

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

const HOST = 'storage.googleapis.com';

export function bucketName(): string {
  const b = Deno.env.get('GCS_BUCKET');
  if (!b) throw new Error('GCS_BUCKET is not configured.');
  return b;
}

function serviceAccount(): ServiceAccount {
  const raw = Deno.env.get('GCS_SA_KEY');
  if (!raw) throw new Error('GCS_SA_KEY is not configured.');
  let parsed: ServiceAccount;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('GCS_SA_KEY is not valid JSON — paste the whole key file.');
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('GCS_SA_KEY is missing client_email/private_key.');
  }
  return parsed;
}

/** Import the PEM (PKCS#8) private key for RSA-SHA256 signing. */
let keyPromise: Promise<CryptoKey> | null = null;
function signingKey(): Promise<CryptoKey> {
  if (!keyPromise) {
    keyPromise = (async () => {
      const pem = serviceAccount()
        .private_key.replace(/-----BEGIN PRIVATE KEY-----/, '')
        .replace(/-----END PRIVATE KEY-----/, '')
        .replace(/\s+/g, '');
      const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
      return crypto.subtle.importKey(
        'pkcs8',
        der,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign']
      );
    })();
  }
  return keyPromise;
}

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256Hex(text: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

async function signHex(text: string): Promise<string> {
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    await signingKey(),
    new TextEncoder().encode(text)
  );
  return hex(sig);
}

/** Percent-encode per RFC 3986; `/` is kept when encoding object paths. */
function encodePath(path: string): string {
  return path
    .split('/')
    .map((seg) => encodeURIComponent(seg).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}

/**
 * A V4 signed URL for one object. `method` is the HTTP verb the caller will
 * use — PUT to upload, GET to read, DELETE to remove.
 *
 * Only `host` is signed, so callers may send any headers they like (notably
 * Content-Type, which expo-file-system sets on upload).
 */
export async function signedUrl(
  method: 'GET' | 'PUT' | 'DELETE',
  objectPath: string,
  expiresInSeconds = 3600,
  /** Extra response-* query params (e.g. response-content-disposition) — GCS
   *  honors these on the response once they're part of the signed query string. */
  extraParams: Record<string, string> = {}
): Promise<string> {
  const sa = serviceAccount();
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); // YYYYMMDDTHHMMSSZ
  const date = stamp.slice(0, 8);
  const scope = `${date}/auto/storage/goog4_request`;
  const canonicalPath = `/${bucketName()}/${encodePath(objectPath)}`;

  const query = new URLSearchParams({
    'X-Goog-Algorithm': 'GOOG4-RSA-SHA256',
    'X-Goog-Credential': `${sa.client_email}/${scope}`,
    'X-Goog-Date': stamp,
    'X-Goog-Expires': String(expiresInSeconds),
    'X-Goog-SignedHeaders': 'host',
    ...extraParams,
  });
  // GCS requires the query string sorted by key.
  const canonicalQuery = [...query.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  const canonicalRequest = [
    method,
    canonicalPath,
    canonicalQuery,
    `host:${HOST}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'GOOG4-RSA-SHA256',
    stamp,
    scope,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  const signature = await signHex(stringToSign);
  return `https://${HOST}${canonicalPath}?${canonicalQuery}&X-Goog-Signature=${signature}`;
}

/**
 * OAuth2 access token for the JSON API (used for listing/deleting server-side,
 * which signed URLs can't do conveniently). Cached until shortly before expiry.
 */
let cachedToken: { token: string; expiresAt: number } | null = null;
async function accessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token;

  const sa = serviceAccount();
  const iat = Math.floor(Date.now() / 1000);
  const b64url = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const claim = b64url({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/devstorage.read_write',
    aud: 'https://oauth2.googleapis.com/token',
    iat,
    exp: iat + 3600,
  });
  const unsigned = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${claim}`;
  const sigBuf = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    await signingKey(),
    new TextEncoder().encode(unsigned)
  );
  const sig = btoa(String.fromCharCode(...new Uint8Array(sigBuf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${sig}`,
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || 'Could not authenticate with Google Cloud Storage.');
  }
  cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return data.access_token;
}

/** Delete one object. Missing objects are treated as already gone. */
export async function deleteObject(objectPath: string): Promise<void> {
  const res = await fetch(
    `https://${HOST}/storage/v1/b/${bucketName()}/o/${encodeURIComponent(objectPath)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${await accessToken()}` } }
  );
  if (!res.ok && res.status !== 404) {
    throw new Error(`Failed to delete photo (HTTP ${res.status}).`);
  }
}

/** Delete every object under a prefix, e.g. all of one user's photos. */
export async function deletePrefix(prefix: string): Promise<number> {
  const token = await accessToken();
  let pageToken: string | undefined;
  let deleted = 0;
  do {
    const params = new URLSearchParams({ prefix, maxResults: '1000' });
    if (pageToken) params.set('pageToken', pageToken);
    const res = await fetch(
      `https://${HOST}/storage/v1/b/${bucketName()}/o?${params}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error(`Failed to list photos (HTTP ${res.status}).`);
    const page = await res.json();
    for (const item of page.items ?? []) {
      await deleteObject(item.name);
      deleted++;
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return deleted;
}
