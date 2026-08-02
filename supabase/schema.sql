-- EGS CRM — base auth schema (idempotent: safe to re-run)
-- Run this in the new Supabase project's SQL editor.
-- Auth model: every successful Google sign-in is an ADMIN; admin-created
-- email/password accounts are USERS. No allowlist.

-- 1. Roles
do $$ begin
  create type public.user_role as enum ('admin', 'user');
exception when duplicate_object then null;
end $$;

-- 2. (Removed) Admin allowlist — any Google sign-in is now an admin.
drop table if exists public.admin_emails cascade;

-- 3. Profiles (1:1 with auth.users)
create table if not exists public.profiles (
  id                  uuid primary key references auth.users (id) on delete cascade,
  email               text not null,
  display_name        text,
  role                public.user_role not null default 'user',
  restricted_features text[] not null default '{}',
  mobile_phone        text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- 4. Auto-create a profile when a new auth user is created.
--    Google sign-in → 'admin'. Everyone else (admin-created
--    email/password accounts) → 'user'.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_provider text := new.raw_app_meta_data->>'provider';
  v_role public.user_role := case when v_provider = 'google' then 'admin' else 'user' end;
  v_name text := coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1));
begin
  insert into public.profiles (id, email, display_name, role)
  values (new.id, new.email, v_name, v_role);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 5. Helper: is the current user an admin?
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

-- 6. Row Level Security
alter table public.profiles enable row level security;

-- profiles: users read/update self; admins read/update everyone
drop policy if exists "profiles read self or admin" on public.profiles;
create policy "profiles read self or admin"
  on public.profiles for select
  using (auth.uid() = id or public.is_admin());

drop policy if exists "profiles update self or admin" on public.profiles;
create policy "profiles update self or admin"
  on public.profiles for update
  using (auth.uid() = id or public.is_admin());

-- 7. Backfill: promote any existing Google accounts to admin (the trigger only
--    runs on new signups, so fix rows created before this change).
update public.profiles p
set role = 'admin'
from auth.users u
where u.id = p.id
  and u.raw_app_meta_data->>'provider' = 'google'
  and p.role <> 'admin';

-- ============================================================================
-- 8. Field visits: admins assign a broad AREA (date, user, free-text area
--    label, no pin). Forms default to the single global fixed form (see
--    app_settings below) but admin can optionally override with a different
--    form per area assignment via form_id/form_url. Users log N location
--    visits/day against their area, each with their own live-GPS place,
--    bulk photos, and notes.
-- ============================================================================

create table if not exists public.assignments (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  assigned_date  date not null,
  area_label     text not null,
  form_id        text, -- optional override of the global field form; null = use default
  form_url       text,
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists assignments_user_date_idx
  on public.assignments (user_id, assigned_date);

create table if not exists public.location_visits (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  place_label   text not null,     -- name/address of the place the visit is for
  latitude      double precision not null, -- device's live GPS at submit time
  longitude     double precision not null,
  distance_m    numeric not null,  -- distance between live GPS and the picked place
  notes         text not null default '',
  submitted_at  timestamptz not null default now()
);
create index if not exists location_visits_assignment_idx
  on public.location_visits (assignment_id);

-- Provenance of the place on a visit. The app captures the place from the
-- device's live GPS (nearby-places lookup) rather than free text, so the
-- coordinates are always machine-captured and only the *label* is editable.
-- These columns are what the admin scrutinises instead of distance_m, which is
-- near-zero by construction once the place is derived from GPS:
--   place_source  how the place was obtained — 'nearby' (picked off the
--                 GPS-derived list), 'reverse_geocode' (street address at the
--                 GPS point), or 'manual_search' (user searched it by hand).
--   label_edited  user typed over the fetched name (coordinates unaffected).
--   gps_accuracy_m  reported accuracy of the fix the list was built from; a
--                 loose fix means the nearby list may be the wrong building.
--   fetched_at    when the location was fetched; the gap to submitted_at
--                 catches "fetch here, submit somewhere else later".
-- All nullable: visits logged before this flow existed have none of them.
alter table public.location_visits
  add column if not exists place_id       text,
  add column if not exists place_source   text
    check (place_source in ('nearby', 'reverse_geocode', 'manual_search')),
  add column if not exists label_edited   boolean not null default false,
  add column if not exists gps_accuracy_m numeric,
  add column if not exists fetched_at     timestamptz;

create table if not exists public.visit_photos (
  id         uuid primary key default gen_random_uuid(),
  visit_id   uuid not null references public.location_visits (id) on delete cascade,
  photo_path text not null,
  created_at timestamptz not null default now()
);

alter table public.assignments      enable row level security;
alter table public.location_visits  enable row level security;
alter table public.visit_photos     enable row level security;

-- assignments: admins manage everything; users read only their own
drop policy if exists "assignments admin all" on public.assignments;
create policy "assignments admin all"
  on public.assignments for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "assignments read own" on public.assignments;
create policy "assignments read own"
  on public.assignments for select
  using (auth.uid() = user_id or public.is_admin());

-- location_visits: users insert/read/update their own; admins read all
drop policy if exists "visits insert own" on public.location_visits;
create policy "visits insert own"
  on public.location_visits for insert
  with check (auth.uid() = user_id);

drop policy if exists "visits read own or admin" on public.location_visits;
create policy "visits read own or admin"
  on public.location_visits for select
  using (auth.uid() = user_id or public.is_admin());

-- Notes/photos are editable anytime (no EOD lock) — see app/(workspace)/visit-edit.tsx.
drop policy if exists "visits update own" on public.location_visits;
create policy "visits update own"
  on public.location_visits for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- visit_photos has no user_id of its own — gate through the parent visit.
drop policy if exists "visit photos insert own" on public.visit_photos;
create policy "visit photos insert own"
  on public.visit_photos for insert
  with check (exists (
    select 1 from public.location_visits v where v.id = visit_id and v.user_id = auth.uid()
  ));

drop policy if exists "visit photos read own or admin" on public.visit_photos;
create policy "visit photos read own or admin"
  on public.visit_photos for select
  using (exists (
    select 1 from public.location_visits v
    where v.id = visit_id and (v.user_id = auth.uid() or public.is_admin())
  ));

drop policy if exists "visit photos delete own" on public.visit_photos;
create policy "visit photos delete own"
  on public.visit_photos for delete
  using (exists (
    select 1 from public.location_visits v where v.id = visit_id and v.user_id = auth.uid()
  ));

-- ============================================================================
-- 9. Visit photo files live in a private Google Cloud Storage bucket, not in
--    Supabase Storage — `visit_photos.photo_path` is a GCS object name of the
--    form <uid>/<visit_id>/<n>-<ts>.jpg. There is no bucket or storage policy
--    to declare here: GCS can't evaluate a Supabase JWT, so the `gcs-sign`
--    Edge Function enforces the equivalent rules (own photos, or any photo for
--    an admin) and issues short-lived signed URLs. See docs/GCS_SETUP.md.
--
--    The policies above on public.visit_photos still guard the *rows*.
-- ============================================================================

-- ============================================================================
-- 10. Google OAuth refresh tokens (for the Forms API). Sensitive — RLS denies
--     all client access; only Edge Functions (service role) read/write these.
-- ============================================================================
create table if not exists public.google_credentials (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  refresh_token text not null,
  updated_at    timestamptz not null default now()
);
alter table public.google_credentials enable row level security;
-- No policies = no anon/authenticated access. Service role bypasses RLS.

-- ============================================================================
-- 11. Google Forms created in-app. Rows are written by the google-forms Edge
--     Function (service role) after creating the form via the Forms API.
-- ============================================================================
create table if not exists public.forms (
  id            text primary key,          -- Google form id
  title         text not null,
  responder_uri text not null,             -- public fill/submit URL
  edit_uri      text,                       -- Google Forms editor URL
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now()
);
alter table public.forms enable row level security;

-- Admins read/manage all forms; normal users can read (to open assigned links).
drop policy if exists "forms read all authed" on public.forms;
create policy "forms read all authed"
  on public.forms for select to authenticated
  using (true);

drop policy if exists "forms admin write" on public.forms;
create policy "forms admin write"
  on public.forms for all
  using (public.is_admin()) with check (public.is_admin());

-- ============================================================================
-- 12. Face registration. Users register their face once (two selfies
--     cross-verified for quality, see face-auth Edge Function); only the
--     embedding is kept, never the photos. Currently disabled — see
--     FACE_VERIFICATION_ENABLED in lib/types.ts — pending re-wiring into
--     location_visits when re-enabled.
-- ============================================================================
alter table public.profiles add column if not exists face_registered boolean not null default false;

-- Service-role only (edge functions) — same lockdown as google_credentials.
-- No policies = no anon/authenticated access.
create table if not exists public.face_embeddings (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  embedding     jsonb not null,
  registered_at timestamptz not null default now()
);
alter table public.face_embeddings enable row level security;

-- ============================================================================
-- 13. Singleton settings: the one fixed Google Form used for every area, every
--     user, every day (admin designates it from the Forms tab).
-- ============================================================================
create table if not exists public.app_settings (
  id             boolean primary key default true check (id),
  -- No FK to public.forms — the Forms tab lists every Google Form in the
  -- admin's Drive (not just app-created ones), and any of them can be set as
  -- the field form.
  field_form_id  text,
  field_form_url text,
  -- When true, the admin's Responses view (FormResponsesTab) shows verified
  -- who/where/when per response, matched from location_visits — see
  -- lib/visit-match.ts. Nothing is written into the Google Form itself.
  include_visit_context boolean not null default true,
  updated_at     timestamptz not null default now()
);
insert into public.app_settings (id) values (true) on conflict do nothing;
alter table public.app_settings enable row level security;

drop policy if exists "app_settings read all authed" on public.app_settings;
create policy "app_settings read all authed"
  on public.app_settings for select to authenticated using (true);

drop policy if exists "app_settings admin write" on public.app_settings;
create policy "app_settings admin write"
  on public.app_settings for all
  using (public.is_admin()) with check (public.is_admin());

-- Note: visit context (who/where/when per response) is NOT written into the
-- Google Form — an earlier prefill-question approach was replaced because
-- respondents could see/edit those fields. Instead the Responses view
-- (components/forms/FormResponsesTab.tsx) matches each response to a
-- location_visits row by submission time (see lib/visit-match.ts), using data
-- the field user never touches.

-- ============================================================================
-- 11. Push notification device tokens (Expo). Field users get a push when an
--     admin assigns them an area. Tokens are registered by the app after login;
--     the notify-assignment Edge Function (service role) reads them to send.
-- ============================================================================
create table if not exists public.push_device_tokens (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  expo_push_token text not null,
  platform        text,
  updated_at      timestamptz not null default now(),
  unique (user_id, expo_push_token)
);
create index if not exists push_device_tokens_user_id_idx
  on public.push_device_tokens (user_id);

alter table public.push_device_tokens enable row level security;

-- Each user manages only their own tokens. (Service role bypasses RLS to read
-- them when sending.)
drop policy if exists push_device_tokens_select_own on public.push_device_tokens;
create policy push_device_tokens_select_own on public.push_device_tokens
  for select to authenticated using (user_id = auth.uid());

drop policy if exists push_device_tokens_insert_own on public.push_device_tokens;
create policy push_device_tokens_insert_own on public.push_device_tokens
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists push_device_tokens_update_own on public.push_device_tokens;
create policy push_device_tokens_update_own on public.push_device_tokens
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists push_device_tokens_delete_own on public.push_device_tokens;
create policy push_device_tokens_delete_own on public.push_device_tokens
  for delete to authenticated using (user_id = auth.uid());
