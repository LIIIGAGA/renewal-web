-- Apply once in Supabase SQL Editor or with supabase db push.
create extension if not exists pgcrypto;

create table public.allowed_users (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.allowed_users enable row level security;
create policy "Read own access" on public.allowed_users for select to authenticated using (user_id = auth.uid());
revoke all on public.allowed_users from anon, authenticated;
grant select on public.allowed_users to authenticated;

create function public.is_allowed_user() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.allowed_users where user_id = auth.uid());
$$;
revoke all on function public.is_allowed_user() from public, anon;
grant execute on function public.is_allowed_user() to authenticated;

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  service_name text not null check (length(trim(service_name)) between 1 and 100),
  plan text not null default '' check (length(plan) <= 100),
  price numeric(10,2) not null check (price >= 0 and price <= 99999999.99),
  currency text not null check (currency in ('CNY','USD','GBP','EUR','HKD','JPY','AUD','CAD')),
  billing_cycle text not null check (billing_cycle in ('weekly','monthly','quarterly','yearly')),
  next_billing_at timestamptz not null,
  timezone text not null default 'Asia/Shanghai',
  billing_anchor_day integer not null check (billing_anchor_day between 1 and 31),
  cancellation_method text not null default '' check (length(cancellation_method) <= 2000),
  cancellation_url text not null default '' check (length(cancellation_url) <= 2048 and (cancellation_url = '' or cancellation_url ~* '^https?://[^[:space:]]+$')),
  notes text not null default '' check (length(notes) <= 2000),
  auto_renew boolean not null default true,
  reminder_enabled boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index subscriptions_owner_date on public.subscriptions(user_id, next_billing_at);
alter table public.subscriptions enable row level security;
create policy "Owner access only" on public.subscriptions for all to authenticated
using (user_id = auth.uid() and public.is_allowed_user())
with check (user_id = auth.uid() and public.is_allowed_user());
revoke all on public.subscriptions from anon, authenticated;
grant select, insert, update, delete on public.subscriptions to authenticated;

create function public.validate_subscription() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists(select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Invalid timezone';
  end if;
  if new.next_billing_at < '2000-01-01'::timestamptz or new.next_billing_at > '2200-01-01'::timestamptz then
    raise exception 'Billing date must be between 2000 and 2200';
  end if;
  new.updated_at = clock_timestamp();
  return new;
end;
$$;
create trigger validate_subscription before insert or update on public.subscriptions
for each row execute function public.validate_subscription();

create table public.reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  billing_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','sending','sent','failed','cancelled')),
  attempts integer not null default 0,
  lease_until timestamptz,
  lease_token uuid,
  sent_at timestamptz,
  last_error text,
  email_payload jsonb,
  created_at timestamptz not null default now(),
  constraint reminders_subscription_billing_unique unique(subscription_id, billing_at)
);
alter table public.reminder_deliveries enable row level security;
create policy "Owner reads reminder logs" on public.reminder_deliveries for select to authenticated
using (user_id = auth.uid() and public.is_allowed_user());
revoke all on public.reminder_deliveries from anon, authenticated;
-- The immutable email snapshot contains an address; expose only operational columns to the UI.
grant select(id,subscription_id,user_id,billing_at,status,attempts,sent_at,last_error,created_at) on public.reminder_deliveries to authenticated;
grant all on public.allowed_users, public.subscriptions, public.reminder_deliveries to service_role;

-- Preserve local wall time and the original billing day, including Jan 31 -> Feb 28 -> Mar 31.
create function public.next_billing_time(current_at timestamptz, cycle text, zone text, anchor_day integer)
returns timestamptz language plpgsql immutable set search_path = '' as $$
declare
  local_at timestamp := current_at at time zone zone;
  month_start timestamp;
  last_day integer;
  months integer;
begin
  if cycle = 'weekly' then return (local_at + interval '7 days') at time zone zone; end if;
  months := case cycle when 'monthly' then 1 when 'quarterly' then 3 when 'yearly' then 12 else null end;
  if months is null then raise exception 'Invalid cycle'; end if;
  month_start := date_trunc('month', local_at) + make_interval(months => months);
  last_day := extract(day from month_start + interval '1 month - 1 day');
  return (month_start + make_interval(days => least(anchor_day, last_day) - 1) + (local_at - date_trunc('day', local_at))) at time zone zone;
end;
$$;

-- Service-role-only RPC. Claiming is atomic, with a short lease for crash recovery.
create function public.claim_due_reminders(batch_size integer default 10)
returns table(delivery_id uuid, subscription_id uuid, user_id uuid, billing_at timestamptz, lease_token uuid)
language plpgsql security definer set search_path = '' as $$
declare
  s record;
  future_at timestamptz;
begin
  -- Only the scheduled cloud worker advances planned auto-renew dates; no payment is inferred.
  for s in select sub.* from public.subscriptions sub join public.allowed_users a on a.user_id = sub.user_id
    where sub.active and sub.auto_renew and sub.next_billing_at <= now() for update of sub skip locked
  loop
    future_at := s.next_billing_at;
    while future_at <= now() loop
      future_at := public.next_billing_time(future_at, s.billing_cycle, s.timezone, s.billing_anchor_day);
    end loop;
    update public.subscriptions sub set next_billing_at = future_at where sub.id = s.id;
  end loop;

  insert into public.reminder_deliveries(subscription_id, user_id, billing_at)
  select sub.id, sub.user_id, sub.next_billing_at from public.subscriptions sub
  join public.allowed_users a on a.user_id = sub.user_id
  where sub.active and sub.reminder_enabled and sub.next_billing_at > now()
    and sub.next_billing_at - interval '24 hours' <= now()
  on conflict on constraint reminders_subscription_billing_unique do update set status = 'pending', attempts = 0, lease_until = null
  where public.reminder_deliveries.status = 'cancelled';

  update public.reminder_deliveries d set status = 'cancelled', lease_until = null
  where d.status <> 'sent' and d.status <> 'cancelled' and not exists (
    select 1 from public.subscriptions sub join public.allowed_users a on a.user_id = sub.user_id
    where sub.id = d.subscription_id and sub.active and sub.reminder_enabled
      and sub.next_billing_at = d.billing_at and sub.next_billing_at > now()
  );

  return query
  with candidates as (
    select d.id from public.reminder_deliveries d
    where d.status in ('pending','failed','sending') and d.attempts < 20
      and (d.lease_until is null or d.lease_until < now())
    order by d.billing_at limit greatest(1,least(batch_size,10)) for update skip locked
  ), claimed as (
    update public.reminder_deliveries d set status = 'sending', attempts = d.attempts + 1,
      lease_until = now() + interval '5 minutes', lease_token = gen_random_uuid()
    from candidates c where c.id = d.id returning d.*
  ) select c.id, c.subscription_id, c.user_id, c.billing_at, c.lease_token from claimed c;
end;
$$;

-- Freeze the provider request across retries. Resend rejects an idempotency key with a changed body.
create function public.prepare_reminder(delivery uuid, token uuid, payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved jsonb;
begin
  update public.reminder_deliveries set email_payload = coalesce(email_payload, payload)
  where id = delivery and lease_token = token and status = 'sending'
  returning email_payload into saved;
  return saved;
end;
$$;

create function public.finish_reminder(delivery uuid, token uuid, result text, error_message text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if result not in ('sent','failed','cancelled') then raise exception 'Invalid result'; end if;
  update public.reminder_deliveries set status = result,
    sent_at = case when result = 'sent' then now() else sent_at end,
    lease_until = null, last_error = left(error_message, 300)
  where id = delivery and lease_token = token and status = 'sending';
end;
$$;
revoke all on function public.claim_due_reminders(integer) from public, anon, authenticated;
revoke all on function public.finish_reminder(uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.prepare_reminder(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.claim_due_reminders(integer), public.finish_reminder(uuid,uuid,text,text), public.prepare_reminder(uuid,uuid,jsonb) to service_role;

-- Realtime is an enhancement; foreground polling also refreshes every minute.
do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'subscriptions') then
    alter publication supabase_realtime add table public.subscriptions;
  end if;
end $$;
