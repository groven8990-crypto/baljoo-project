-- 매출 보고 — 발주 자동화가 계산한 날짜별 보고서(매출 · 매입 · 수수료 · 부가세 · 순이익)를 받아 둡니다.
-- draft     : 보고서를 만들기만 한 상태 (진행 중 / 확인 중)
-- confirmed : '이력에 저장'까지 누른 마감 확정
create table if not exists public.report_snapshots (
  report_date date primary key,
  status      text not null check (status in ('draft', 'confirmed')),
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);

alter table public.report_snapshots enable row level security;

-- 팀원이면 누구나 읽기 (보기 전용 포함)
create policy report_snapshots_read on public.report_snapshots
  for select using (public.my_role() is not null);

alter publication supabase_realtime add table public.report_snapshots;
