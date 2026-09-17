-- Existing Supabase deployments: apply once AFTER the initial migration.
-- GitHub and local ledger modes do not need a database migration.
alter table public.subscriptions
  add column category text not null default '其他'
  check (category in ('AI','视频','音乐','其他'));
