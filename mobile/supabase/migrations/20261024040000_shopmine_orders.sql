-- 샵마인 엑셀에서 온 주문: 쇼핑몰 구분 없이 'shopmine' 계정 하나로 받고, orders.platform 에 '쿠팡-로또상회' 같은 판매처 이름을 넣습니다
-- (enabled=false — collect-orders 의 쇼핑몰 API 수집 대상이 아님)
alter table public.channel_accounts drop constraint if exists channel_accounts_platform_check;
alter table public.channel_accounts add constraint channel_accounts_platform_check
  check (platform in ('coupang', 'naver', '11st', 'esm', 'shopmine'));
insert into public.channel_accounts (id, platform, store_name, business, secret_ref, enabled)
values ('shopmine', 'shopmine', '샵마인', '전체', 'SHOPMINE', false)
on conflict (id) do nothing;

-- 웹 푸시 키는 app_secrets 에 VAPID_PUBLIC_KEY · VAPID_PRIVATE_KEY · VAPID_SUBJECT 로 넣습니다 (저장소에는 넣지 않음)
