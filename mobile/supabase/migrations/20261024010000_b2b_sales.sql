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
