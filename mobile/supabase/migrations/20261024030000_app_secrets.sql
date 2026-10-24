-- 서버 함수만 읽는 비밀값 (RLS 를 켜고 정책을 두지 않아 앱 · 공개 키로는 읽을 수 없음).
-- BALJOO_SYNC_KEY: 발주 자동화 → 폰 앱 연동 키. 대시보드 Secrets 에 같은 이름이 있으면 그 값이 우선합니다.
create extension if not exists pgcrypto with schema extensions;
create table if not exists public.app_secrets (
  name  text primary key,
  value text not null
);
alter table public.app_secrets enable row level security;
insert into public.app_secrets (name, value)
values ('BALJOO_SYNC_KEY', encode(extensions.gen_random_bytes(18), 'hex'))
on conflict (name) do nothing;

-- my_role() 은 로그인한 팀원만 부를 수 있게 (로그인 전 익명 호출 막기)
revoke execute on function public.my_role() from anon, public;
