-- 5분마다 collect-orders 를 부르는 예약 작업 (Supabase SQL Editor 에서 한 번 실행)
-- <PROJECT_REF> 와 <CRON_SECRET> 은 실제 값으로 바꿔서 실행하세요.
-- CRON_SECRET 은 Edge Function 비밀값 CRON_SECRET 과 같은 값이어야 합니다.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret('<CRON_SECRET>', 'collect_orders_cron_secret');

select cron.schedule(
  'collect-orders-every-5min',
  '*/5 * * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/collect-orders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'collect_orders_cron_secret')
    ),
    body    := '{}'::jsonb
  );
  $$
);
