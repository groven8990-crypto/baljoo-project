-- 서버 함수만 읽는 비밀값 (RLS 를 켜고 정책을 두지 않아 앱 · 공개 키로는 읽을 수 없음).
-- BALJOO_SYNC_KEY: 발주 자동화 → 폰 앱 연동 키. 대시보드 Secrets 에 같은 이름이 있으면 그 값이 우선합니다.
create extension if not exists pgcrypto;
create table if not exists public.app_secrets (
  name  text primary key,
  value text not null
);
alter table public.app_secrets enable row level security;
insert into public.app_secrets (name, value)
values ('BALJOO_SYNC_KEY', encode(gen_random_bytes(18), 'hex'))
on conflict (name) do nothing;
