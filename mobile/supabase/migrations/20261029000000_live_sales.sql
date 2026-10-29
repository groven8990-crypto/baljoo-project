-- 실시간 매출: 쇼핑몰 API(쿠팡 · 네이버)와 샵마인으로 들어온 주문을 날짜 · 스토어별 합계로만 돌려줍니다.
-- 주문 목록(orders)은 담당자만 읽을 수 있으므로, 팀원은 이 함수로 합계만 봅니다 (구매자 · 상품 내역은 안 나감).
create or replace function public.live_sales(p_from date, p_to date)
returns table (day date, account_id text, platform text, store text, business text, cnt bigint, amount bigint)
language sql stable security definer set search_path = public as $$
  with o as (
    select (coalesce(o.paid_at, o.ordered_at, o.first_seen_at) at time zone 'Asia/Seoul')::date as day,
           o.account_id, a.platform,
           case when a.platform = 'shopmine' then o.platform else a.store_name end as store,
           case when a.platform <> 'shopmine' then a.business
                when o.platform like '%로또상회%' then '그로븐'
                when o.platform like '%자꾸가게%' then '옐로우브릿지'
                else '-' end as business,
           o.amount
    from orders o join channel_accounts a on a.id = o.account_id
    where public.my_role() is not null
      -- 쿠팡 · 네이버는 API 로 직접 받으므로 샵마인 엑셀의 같은 주문은 빼서 두 번 세지 않음
      and not (a.platform = 'shopmine' and o.platform ~ '쿠팡|coupang|네이버|스마트스토어|naver')
  )
  select day, account_id, platform, store, business, count(*), coalesce(sum(amount), 0)::bigint
  from o where day between p_from and p_to
  group by 1, 2, 3, 4, 5;
$$;
revoke all on function public.live_sales(date, date) from public, anon;
grant execute on function public.live_sales(date, date) to authenticated;
