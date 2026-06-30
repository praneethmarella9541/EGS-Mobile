# EGS CRM — Mobile

A mobile-first CRM built with Expo (React Native) + Supabase. Theme and auth
patterns are adapted from the Placecom workspace app: a warm copper / ink
editorial look, file-based routing (expo-router), and a Supabase-backed
session with a `profiles` table.

## Stack

- **Expo SDK 54** + **expo-router** (typed routes, new architecture)
- **Supabase** auth + Postgres (`@supabase/supabase-js`, PKCE flow)
- **TypeScript**, AsyncStorage session persistence
- Drawer navigation (`react-native-drawer-layout`)

## Auth model

Two roles only:

- **admin** — signs in with **Google**, but only if their email is in the
  `admin_emails` allowlist. Full access + the Team screen + user management.
- **user** — created by an admin (email + password); signs in with those
  credentials. No public sign-up. Access gated per feature via
  `profiles.restricted_features`.

Pieces:
- `hooks/useAuth.ts` — `isAdmin`, `hasFeature`.
- `lib/google-sign-in.ts` + `lib/auth-redirect.ts` — OAuth (PKCE, deep link).
- `app/_layout.tsx` — blocks non-allowlisted Google sign-ins.
- `lib/admin-users.ts` → `supabase/functions/admin-users` — admin creates,
  edits, deletes users (service-role; caller verified as admin).
- `supabase/schema.sql` — `admin_emails`, `profiles`, provider-aware trigger, RLS.

## Setup

1. Create a **new** Supabase project (separate account from Placecom). The
   URL + anon key go in `.env.local`:

   ```
   EXPO_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
   ```

2. Run `supabase/schema.sql` in the Supabase SQL editor.

3. **Seed the first admin** (chicken-and-egg: needed before first Google login):

   ```sql
   insert into public.admin_emails (email) values ('you@company.com');
   ```

4. **Enable Google** in Supabase → Authentication → Providers → Google
   (add your Google OAuth client id/secret). Under Authentication → URL
   Configuration → Redirect URLs, add:

   ```
   egscrm://auth/callback
   ```

5. **Deploy the Edge Function** (requires the Supabase CLI, logged in & linked):

   ```
   supabase functions deploy admin-users
   ```

   `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are injected
   automatically — no extra secrets needed.

6. Install + run (use a dev build for Google deep links; Expo Go works via the
   exp:// proxy):

   ```
   npm install
   npm start
   ```

7. Sign in with Google (your allowlisted email) → you're admin. Open **Team**
   to create email/password users.

## Structure

```
app/
  _layout.tsx              # root: auth provider + AuthGuard (Google admin gate)
  (auth)/login.tsx         # editorial sign-in (Google admin + email/password)
  (auth)/callback.tsx      # OAuth deep-link landing
  auth/callback.tsx        # egscrm://auth/callback target
  (workspace)/
    _layout.tsx            # drawer + role-filtered modules
    dashboard/index.tsx    # home (placeholder stats)
    admin/index.tsx        # Team — admin creates/manages users
    leads|contacts|deals/  # placeholder modules
components/   BrandLogo, LoadingScreen, ScreenHeader, ComingSoon
constants/    colors.ts, theme.ts, branding.ts
hooks/        useAuth.ts
lib/          supabase.ts, types.ts, session-reset.ts,
              google-sign-in.ts, auth-redirect.ts, admin-users.ts
supabase/     schema.sql, functions/admin-users/
```

## Adding modules

The drawer in `app/(workspace)/_layout.tsx` lists modules with a `feature`
key (gated for normal users) and an `adminOnly` flag. Add a screen under
`app/(workspace)/<module>/` and a matching entry in `MODULES`.
