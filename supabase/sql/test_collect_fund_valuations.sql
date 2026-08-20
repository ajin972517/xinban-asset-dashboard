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
  body := '{"force":true,"include_cloud_snapshots":true}'::jsonb
) as request_id;
