# Visit photos on Google Cloud Storage

Visit photos used to live in a private Supabase Storage bucket. They now live in
a private **GCS** bucket. No media of any kind remains in Supabase.

## How access works

Supabase Storage could authorize the mobile app directly, because it understands
the user's JWT. GCS cannot. And a service-account key must never ship inside the
app — anyone can unzip an APK.

So the app holds no Google credential at all. Instead:

```
app ──JWT──► gcs-sign Edge Function ──service account──► signed URL
    ◄──────── short-lived https URL ─────────────────────┘
app ──PUT/GET the signed URL──► storage.googleapis.com
```

[`gcs-sign`](../supabase/functions/gcs-sign/index.ts) is where photo
authorization now lives, reproducing what the old storage RLS policies did:

| Action | Rule |
|---|---|
| `upload` | only onto a visit the caller owns; **the server picks the object path**, so nobody can write outside their own folder |
| `read` | the caller's own photos, or any photo if the caller is an admin |
| `delete` | the caller's own photos only |

Object layout is unchanged from the Supabase days — `<uid>/<visit_id>/<n>-<ts>.jpg`
— so `visit_photos.photo_path` still stores exactly what it always did.

## 1. Bucket

Create a bucket (any name; you'll put it in `GCS_BUCKET`). Settings:

- **Uniform bucket-level access: on**
- **Public access prevention: enabled**

Signed URLs need neither ACLs nor public objects. Do **not** make the bucket
public — the photos are geotagged field-worker images.

### CORS

Native mobile uploads don't use CORS. Two things do:

- the Expo **web** build, and
- the **admin console** (`web/`, deployed on Vercel) — but only its photo
  *download* button. Viewing photos in the console works without any CORS rule,
  because an `<img>` tag is not a cross-origin `fetch`. Without a matching rule
  the download silently falls back to opening the photo in a new tab.

```json
[
  {
    "origin": [
      "https://www.thenucleus.in",
      "https://<your-vercel-domain>",
      "http://localhost:3000"
    ],
    "method": ["GET", "PUT"],
    "responseHeader": ["Content-Type"],
    "maxAgeSeconds": 3600
  }
]
```

Apply it with:

```bash
gcloud storage buckets update gs://<bucket> --cors-file=cors.json
```

## 2. Service account

Create one with **Storage Object Admin** (`roles/storage.objectAdmin`) granted
**on the bucket**, not project-wide. Download its JSON key.

## 3. Supabase secrets

Dashboard → **Edge Functions → Secrets** → add two:

| Name | Value |
|---|---|
| `GCS_SA_KEY` | the entire service-account JSON, pasted verbatim |
| `GCS_BUCKET` | the bucket name |

Paste the JSON exactly as downloaded — don't reformat it or touch the `\n`
escapes inside `private_key`; the function `JSON.parse`s it.

Never put these in `.env.local`. Anything `EXPO_PUBLIC_` there is compiled into
the app binary.

## 4. Deploy

```bash
supabase functions deploy gcs-sign
supabase functions deploy admin-users   # its user-delete purge now targets GCS
```

## 5. One-time cutover

Run **once**, at cutover, in the SQL editor. This is deliberately not in
`schema.sql` — that file is re-runnable, and this would wipe live photos every
time it ran.

**Step 1 — drop the stale photo rows (SQL).** Every existing `visit_photos` row
points at an object in the old Supabase bucket. Those objects are not being
copied, so the rows would render as broken images and 404 on download:

```sql
-- Old photo rows (Supabase-bucket era). Deletes rows only; visits are kept.
delete from public.visit_photos;
```

This one is genuinely a table, so SQL is correct here.

**Step 2 — delete the bucket through the Storage API.** Do *not* delete the
files with SQL. `delete from storage.objects` removes only Supabase's metadata
rows; the files themselves stay in the backing object store, orphaned — still
billed, no longer listable, and no longer deletable through any normal path.
Only the Storage API removes metadata and bytes together.

Dashboard is simplest: **Storage → `visit-photos` → Empty bucket**, then
**Delete bucket**. The API refuses to delete a bucket that still has objects, so
the order matters.

Equivalently, over the Storage REST API with the service-role key:

```bash
SR="<service-role-key>"          # Settings → API. Never commit this.
BASE=https://duxvlnylgwlyqrnhmgkx.supabase.co/storage/v1/bucket/visit-photos

curl -X POST "$BASE/empty"  -H "Authorization: Bearer $SR" -H "apikey: $SR"
curl -X DELETE "$BASE"      -H "Authorization: Bearer $SR" -H "apikey: $SR"
```

The CLI can clear objects too, but it only talks to a *linked* project and has
no bucket-delete command, so it needs `supabase link` first and still leaves you
finishing in the dashboard:

```bash
npx supabase storage rm ss:///visit-photos -r --linked --experimental
```

After step 2, no media reference to Supabase remains.

## 6. Verify

1. Log a visit with 2-3 photos → objects appear in the bucket under
   `<uid>/<visit_id>/`.
2. Reopen the visit → photos render (signed GET, 1 h TTL).
3. Delete a photo in the editor → object disappears from the bucket.
4. As an admin, open another user's visit in Attendance → photos render.
5. Delete a test user in Team → their whole `<uid>/` prefix is gone.

## Troubleshooting

**`SignatureDoesNotMatch`** — almost always a mangled `GCS_SA_KEY`. Re-paste the
JSON whole.

**403 on upload, 200 on read** — the service account is missing
`storage.objects.create`; `objectViewer` isn't enough, use `objectAdmin`.

**`GCS_BUCKET is not configured`** — the secret was added after the last deploy.
Secrets apply on the next invocation, but redeploy if it persists.
