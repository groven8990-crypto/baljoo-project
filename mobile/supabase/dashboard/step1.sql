-- 1단계 설정용 SQL — Supabase 대시보드 → SQL Editor → New query 에 전체를 붙여 넣고 Run
-- (migrations/ 폴더의 두 파일을 순서대로 합친 것 + 맨 아래 대표님 계정 등록)

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

-- 문자매출(직거래) — 폰 앱에서 넣든, 발주 자동화 사이트에서 넣든 이 테이블 하나에 모입니다.
create table if not exists public.b2b_sales (
  id              bigint generated always as identity primary key,
  sale_date       date not null,
  business        text not null check (business in ('그로븐', '옐로우브릿지')),
  client          text,                              -- 거래처/고객 (이름은 마스킹해서 저장)
  item            text not null,
  qty             integer not null default 1 check (qty > 0),
  sales           integer not null check (sales >= 0),
  buy             integer check (buy >= 0),          -- 비어 있으면 '매입 미입력'
  source          text not null check (source in ('phone', 'baljoo')),
  source_ref      text unique,                       -- 발주 사이트 주문번호 (같은 건 재전송 시 덮어쓰기)
  created_by      uuid references public.members (user_id),
  created_by_name text,
  created_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create index if not exists b2b_sales_date_idx on public.b2b_sales (sale_date desc);

alter table public.b2b_sales enable row level security;

-- 팀원이면 누구나 읽기 (보고서 합산용)
create policy b2b_sales_read on public.b2b_sales
  for select using (public.my_role() is not null);

-- 폰 입력: 관리자·실무만, 본인 이름으로
create policy b2b_sales_insert on public.b2b_sales
  for insert with check (
    public.my_role() in ('admin', 'staff') and source = 'phone' and created_by = auth.uid()
  );

-- 삭제는 지우지 않고 deleted_at 만 채웁니다 (관리자·실무)
create policy b2b_sales_update on public.b2b_sales
  for update using (public.my_role() in ('admin', 'staff'))
  with check (public.my_role() in ('admin', 'staff'));

alter publication supabase_realtime add table public.b2b_sales;

-- ── 대표님 계정을 관리자로 등록 ─────────────────────────────
-- 먼저 Authentication → Users → Add user 로 이메일 계정을 만든 뒤,
-- 아래 '여기에-이메일' 을 그 이메일로 바꿔서 이 부분만 다시 실행하세요.
insert into public.members (user_id, name, role)
select id, '대표', 'admin' from auth.users where email = '여기에-이메일'
on conflict (user_id) do update set role = 'admin';
