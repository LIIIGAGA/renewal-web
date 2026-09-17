-- Enable pg_cron and pg_net from Dashboard > Database > Extensions first.
-- Create Vault secrets using the Supabase Vault UI (do not commit real values):
--   renewal_function_url = https://PROJECT.supabase.co/functions/v1/send-reminders
--   renewal_cron_secret  = the exact same CRON_SECRET as the Edge Function
-- Vault is backend-only. Do not expose these values to browser/client code.
do $$ begin
  if exists(select 1 from cron.job where jobname = 'renewal-reminders') then
    perform cron.unschedule('renewal-reminders');
  end if;
end $$;

select cron.schedule('renewal-reminders', '*/15 * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'renewal_function_url'),
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'renewal_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$$);

-- Diagnostics (SQL Editor, administrator only):
-- select jobid, jobname, schedule, active from cron.job where jobname = 'renewal-reminders';
-- select status, return_message, start_time from cron.job_run_details order by start_time desc limit 10;
-- select id, status_code, timed_out, error_msg from net._http_response order by id desc limit 10;
-- The cron SQL success only means HTTP was queued; check HTTP status AND reminder_deliveries.
