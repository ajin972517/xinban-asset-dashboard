create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net;
create extension if not exists supabase_vault with schema vault;

do $vault_setup$
declare
  v_secret_id uuid;
begin
  select id
  into v_secret_id
  from vault.secrets
  where name = 'fund_valuation_collector_secret'
  order by created_at desc
  limit 1;

  if v_secret_id is null then
    perform vault.create_secret(
      '__COLLECTOR_SECRET__',
      'fund_valuation_collector_secret',
      'Secret used by the scheduled fund valuation collector'
    );
  else
    perform vault.update_secret(
      v_secret_id,
      '__COLLECTOR_SECRET__',
      'fund_valuation_collector_secret',
      'Secret used by the scheduled fund valuation collector'
    );
  end if;
end
$vault_setup$;

do $cron_cleanup$
declare
  v_job_id bigint;
begin
  select jobid
  into v_job_id
  from cron.job
  where jobname = 'collect-fund-valuations-weekdays';

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;
end
$cron_cleanup$;

select cron.schedule(
  'collect-fund-valuations-weekdays',
  '10 7 * * 1-5',
  $cron_job$
  select net.http_post(
    url := 'https://pecbhksoxjqorjmzusjb.supabase.co/functions/v1/collect-fund-valuations',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'fund_valuation_collector_secret'
        order by created_at desc
        limit 1
      )
    ),
    body := '{"scheduled":true}'::jsonb
  );
  $cron_job$
);
