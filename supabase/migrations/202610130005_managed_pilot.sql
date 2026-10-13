-- Preserve existing entitlements while restricting new self-service trials to Pricing Assistant.
create table if not exists public.subscription_trial_claims (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  product text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create unique index if not exists subscription_trial_claims_email_product_idx
  on public.subscription_trial_claims (lower(email), product);

create index if not exists subscription_trial_claims_user_id_idx
  on public.subscription_trial_claims(user_id);

alter table public.subscription_trial_claims enable row level security;

drop policy if exists "Users read own trial claims" on public.subscription_trial_claims;
create policy "Users read own trial claims"
  on public.subscription_trial_claims
  for select
  using (auth.uid() = user_id);

drop policy if exists "Admin manages trial claims" on public.subscription_trial_claims;
create policy "Admin manages trial claims"
  on public.subscription_trial_claims
  for all
  using (lower(auth.jwt() ->> 'email') = 'farajsoftwaresolutions@gmail.com')
  with check (lower(auth.jwt() ->> 'email') = 'farajsoftwaresolutions@gmail.com');

alter table public.subscriptions
  add column if not exists access_source text,
  add column if not exists expires_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists subscriptions_user_product_idx
  on public.subscriptions(user_id, product);

drop policy if exists "Users read own subscriptions" on public.subscriptions;
create policy "Users read own subscriptions"
  on public.subscriptions
  for select
  using (auth.uid() = user_id);

create or replace function public.start_product_trial(requested_product text)
returns table (
  product text,
  status text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth
as $$
#variable_conflict use_column
declare
  trial_email text;
  trial_user_id uuid;
  normalized_product text;
  trial_expires_at timestamptz;
begin
  trial_user_id := auth.uid();
  trial_email := lower(auth.jwt() ->> 'email');
  normalized_product := lower(trim(requested_product));

  if trial_user_id is null or trial_email is null or trial_email = '' then
    raise exception 'You must be signed in to start a trial.';
  end if;

  if normalized_product = 'shift_planner' then
    raise exception 'Shift Planner uses managed pilot access. Contact Reimage Tech.';
  end if;

  if normalized_product not in ('pricing_assistant_pro') then
    raise exception 'Trial is not available for this product.';
  end if;

  select claim.expires_at
    into trial_expires_at
  from public.subscription_trial_claims claim
  where lower(claim.email) = trial_email
    and claim.product = normalized_product;

  if trial_expires_at is not null then
    if trial_expires_at <= now() then
      raise exception 'A trial has already been used for this email.';
    end if;
  else
    trial_expires_at := now() + interval '7 days';

    insert into public.subscription_trial_claims (email, product, user_id, expires_at)
    values (trial_email, normalized_product, trial_user_id, trial_expires_at);
  end if;

  insert into public.subscriptions (
    user_id,
    product,
    status,
    access_source,
    expires_at,
    updated_at
  )
  values (
    trial_user_id,
    normalized_product,
    'trialing',
    'email_7_day_trial',
    trial_expires_at,
    now()
  )
  on conflict (user_id, product)
  do update set
    status = excluded.status,
    access_source = excluded.access_source,
    expires_at = excluded.expires_at,
    updated_at = now();

  return query
  select normalized_product, 'trialing'::text, trial_expires_at;
end;
$$;

revoke all on function public.start_product_trial(text) from public;
grant execute on function public.start_product_trial(text) to authenticated;
