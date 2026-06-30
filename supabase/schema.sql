-- EGS CRM — base auth schema (idempotent: safe to re-run)
-- Run this in the new Supabase project's SQL editor.
-- TESTING MODE: signup picks the role (admin/user). Google allowlist gate parked.

-- 1. Roles
do $$ begin
  create type public.user_role as enum ('admin', 'user');
exception when duplicate_object then null;
end $$;

-- 2. Admin allowlist (used later when the Google admin gate is re-enabled).
create table if not exists public.admin_emails (
  email      text primary key,
  created_at timestamptz not null default now()
);

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
--    Google sign-in → admin ONLY if the email is allowlisted (admin_emails).
--    Everyone else (admin-created email/password users) → 'user'.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_provider text := new.raw_app_meta_data->>'provider';
  v_is_allowlisted boolean := exists (
    select 1 from public.admin_emails where lower(email) = lower(new.email)
  );
  v_role public.user_role :=
    case when v_provider = 'google' and v_is_allowlisted then 'admin' else 'user' end;
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
alter table public.admin_emails enable row level security;

-- profiles: users read/update self; admins read/update everyone
drop policy if exists "profiles read self or admin" on public.profiles;
create policy "profiles read self or admin"
  on public.profiles for select
  using (auth.uid() = id or public.is_admin());

drop policy if exists "profiles update self or admin" on public.profiles;
create policy "profiles update self or admin"
  on public.profiles for update
  using (auth.uid() = id or public.is_admin());

-- admin_emails: only admins can see/manage the allowlist
drop policy if exists "admin_emails admin only" on public.admin_emails;
create policy "admin_emails admin only"
  on public.admin_emails for all
  using (public.is_admin())
  with check (public.is_admin());

-- 7. BOOTSTRAP (only needed later, for the Google admin gate):
--    insert into public.admin_emails (email) values ('you@company.com');

-- ============================================================================
-- 8. Field attendance: admins assign (date, user, location, form); users check
--    in with a photo + geo-verification, which unlocks the form link.
-- ============================================================================

create table if not exists public.assignments (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  assigned_date  date not null,
  location_label text not null,
  latitude       double precision not null,
  longitude      double precision not null,
  form_url       text not null,
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists assignments_user_date_idx
  on public.assignments (user_id, assigned_date);

create table if not exists public.attendance (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null unique references public.assignments (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  photo_path    text not null,
  captured_lat  double precision not null,
  captured_lng  double precision not null,
  distance_m    numeric not null,
  verified      boolean not null default true,
  submitted_at  timestamptz not null default now()
);

alter table public.assignments enable row level security;
alter table public.attendance  enable row level security;

-- assignments: admins manage everything; users read only their own
drop policy if exists "assignments admin all" on public.assignments;
create policy "assignments admin all"
  on public.assignments for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "assignments read own" on public.assignments;
create policy "assignments read own"
  on public.assignments for select
  using (auth.uid() = user_id or public.is_admin());

-- attendance: users insert/read their own; admins read all
drop policy if exists "attendance insert own" on public.attendance;
create policy "attendance insert own"
  on public.attendance for insert
  with check (auth.uid() = user_id);

drop policy if exists "attendance read own or admin" on public.attendance;
create policy "attendance read own or admin"
  on public.attendance for select
  using (auth.uid() = user_id or public.is_admin());

-- ============================================================================
-- 9. Storage bucket for attendance photos (private). Files live under <uid>/...
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('attendance-photos', 'attendance-photos', false)
on conflict (id) do nothing;

drop policy if exists "attendance photos insert own" on storage.objects;
create policy "attendance photos insert own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'attendance-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "attendance photos read own or admin" on storage.objects;
create policy "attendance photos read own or admin"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'attendance-photos'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

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
