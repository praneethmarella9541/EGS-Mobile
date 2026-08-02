# Google + Supabase setup (admin sign-in & Google Forms)

Follow these once. They enable: admin Google sign-in, and (Phase 1) creating
Google Forms from inside the app. Replace `<PROJECT-REF>` with your Supabase
project ref (the part before `.supabase.co` — yours is `duxvlnylgwlyqrnhmgkx`).

---

## 1. Google Cloud project + APIs

1. Go to <https://console.cloud.google.com> → create/select a project.
2. **APIs & Services → Library** → enable both:
   - **Google Forms API**
   - **Google Drive API** (used to list/manage forms the app creates)

## 2. OAuth consent screen

1. **APIs & Services → OAuth consent screen** → User type **External** → Create.
2. Fill app name, support email, developer email.
3. **Scopes** → Add these (search by name):
   - `.../auth/userinfo.email`, `.../auth/userinfo.profile`, `openid`
   - `.../auth/forms.body`
   - `.../auth/forms.responses.readonly`
   - `.../auth/drive.file`
4. **Test users** → add every admin's Google email (while the app is in
   "Testing" mode, only these can sign in). Publish later to remove this limit.

## 3. OAuth client credentials (Web application)

Supabase performs the OAuth handshake, so you need a **Web application** client
(not Android/iOS).

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Web application**.
3. **Authorized redirect URIs** → add exactly:
   ```
   https://<PROJECT-REF>.supabase.co/auth/v1/callback
   ```
4. Create → copy the **Client ID** and **Client secret**.

## 4. Supabase → Google provider

1. Supabase dashboard → **Authentication → Providers → Google** → enable.
2. Paste the **Client ID** and **Client secret** from step 3 → Save.
3. **Authentication → URL Configuration → Redirect URLs** → add:
   ```
   egscrm://auth/callback
   http://localhost:3000/auth/callback
   https://<your-vercel-domain>/auth/callback
   ```
   The first is the mobile app; the last two are the admin web console in
   `web/` (local dev and production). Also add your Expo dev URL, e.g.
   `exp://…/--/auth/callback`, when testing in Expo Go.

   No change is needed in Google Cloud for the web console — its authorized
   redirect URI stays `https://<PROJECT-REF>.supabase.co/auth/v1/callback`,
   because Supabase performs the final hop back to whichever app started the flow.

## 5. Supabase Edge Function secrets

The Forms functions (Phase 1) refresh Google tokens using your client secret.
Set these once (Supabase CLI, logged in & linked):

```bash
supabase secrets set GOOGLE_CLIENT_ID="<client-id>" GOOGLE_CLIENT_SECRET="<client-secret>"
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are injected
automatically — don't set those.

## 6. Database + functions

1. Run `supabase/schema.sql` in the SQL editor (idempotent). Any Google
   sign-in becomes an admin automatically — no allowlist to seed.
2. Deploy the functions:
   ```bash
   supabase functions deploy google-link
   supabase functions deploy admin-users
   supabase functions deploy gcs-sign
   ```
   `gcs-sign` brokers visit-photo storage — see [GCS_SETUP.md](GCS_SETUP.md) for
   its bucket and secrets.

## 7. Test

1. Build a dev client (`npx expo run:android` / `run:ios`) — Google deep-link
   sign-in needs a real build (or the Expo Go `exp://` proxy).
2. Open the app → **Continue with Google** → lands in the workspace as **admin**.
3. As admin → **Team** → create an email/password user.
4. Sign out, sign in as that user with those credentials → you see **My Tasks**.

---

### Notes
- We request `access_type=offline` + `prompt=consent`, so Google returns a
  **refresh token** on sign-in; it's stored server-side via the `google-link`
  function (table `google_credentials`, RLS-locked) for the Forms API.
- If an admin ever revokes access, just sign in again to re-store the token.
