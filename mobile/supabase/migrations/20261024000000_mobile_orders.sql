-- 모바일 주문 알림 앱 — 기본 테이블
-- 쇼핑몰 API에서 직접 가져온 주문을 저장하고, 팀원 권한별로 읽게 합니다.
-- 기존 발주 자동화(exp_hist 등) 테이블은 건드리지 않습니다.

-- ── 팀원 · 권한 ─────────────────────────────────────────────
create table if not exists public.members (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  name       text not null,
  role       text not null default 'viewer' check (role in ('admin', 'staff', 'viewer')),
  created_at timestamptz not null default now()
);

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.members where user_id = auth.uid()
$$;

-- ── 쇼핑몰 계정 (쿠팡-로또상회, 쿠팡-자꾸가게 …) ─────────────
-- 인증키는 여기에 저장하지 않습니다. secret_ref 로 Edge Function 비밀값 이름만 가리킵니다.
create table if not exists public.channel_accounts (
  id             text primary key,                 -- 예: 'coupang-lotto'
  platform       text not null check (platform in ('coupang', 'naver', '11st', 'esm')),
  store_name     text not null,                    -- 로또상회 / 자꾸가게
  business       text not null,                    -- 그로븐 / 옐로우브릿지
  secret_ref     text not null,                    -- 예: 'LOTTO' → COUPANG_LOTTO_ACCESS_KEY …
  enabled        boolean not null default false,
  last_synced_at timestamptz,
  last_error     text
);

-- ── 주문 (상품주문 단위) ─────────────────────────────────────
-- 개인정보는 알림·목록에 필요한 만큼만 남깁니다 (이름 마스킹, 주소는 시·구까지).
create table if not exists public.orders (
  id                bigint generated always as identity primary key,
  account_id        text not null references public.channel_accounts (id),
  platform          text not null,
  external_order_id text not null,
  external_item_id  text not null,
  status            text,
  ordered_at        timestamptz,
  paid_at           timestamptz,
  product_name      text,
  option_name       text,
  qty               integer not null default 1,
  amount            integer not null default 0,
  buyer_masked      text,
  receiver_region   text,
  first_seen_at     timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (platform, external_order_id, external_item_id)
);
create index if not exists orders_paid_at_idx on public.orders (paid_at desc);
create index if not exists orders_account_idx on public.orders (account_id, paid_at desc);

-- ── 푸시 구독 (폰마다 1건) ───────────────────────────────────
create table if not exists public.push_subscriptions (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.members (user_id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  prefs      jsonb not null default '{"order": true}'::jsonb,
  created_at timestamptz not null default now()
);

-- ── 접근 권한 (RLS) ──────────────────────────────────────────
alter table public.members            enable row level security;
alter table public.channel_accounts   enable row level security;
alter table public.orders             enable row level security;
alter table public.push_subscriptions enable row level security;

-- 팀원 목록: 팀원이면 읽기, 변경은 관리자만
create policy members_read on public.members
  for select using (public.my_role() is not null);
create policy members_admin_write on public.members
  for all using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

-- 쇼핑몰 계정 상태: 관리자·실무만
create policy accounts_read on public.channel_accounts
  for select using (public.my_role() in ('admin', 'staff'));

-- 주문: 관리자·실무만 (보기 전용은 주문 목록이 아니라 매출 보고서만 봅니다)
create policy orders_read on public.orders
  for select using (public.my_role() in ('admin', 'staff'));

-- 푸시 구독: 본인 것만
create policy push_own on public.push_subscriptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 앱에서 새 주문이 바로 보이도록 실시간 구독 허용
alter publication supabase_realtime add table public.orders;
