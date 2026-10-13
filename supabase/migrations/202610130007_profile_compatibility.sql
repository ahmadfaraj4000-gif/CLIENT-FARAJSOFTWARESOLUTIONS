-- Older portal installations only had email, plan and subscription_active.
-- Add the fields used by the admin portal without replacing existing profile data.
alter table public.profiles
  add column if not exists full_name text,
  add column if not exists admin_notes text,
  add column if not exists updated_at timestamptz not null default now();
