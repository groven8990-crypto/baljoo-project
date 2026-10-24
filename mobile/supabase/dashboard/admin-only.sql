-- CS(주문 목록) · 문자매출 입력 · 쇼핑몰 계정은 담당자(admin)만. 나머지 팀원은 현황 · 보고서 · 순마진 보기 + 신규 주문 알림만.
drop policy if exists orders_read on public.orders;
create policy orders_read on public.orders
  for select using (public.my_role() = 'admin');

drop policy if exists accounts_read on public.channel_accounts;
create policy accounts_read on public.channel_accounts
  for select using (public.my_role() = 'admin');

drop policy if exists b2b_sales_insert on public.b2b_sales;
create policy b2b_sales_insert on public.b2b_sales
  for insert with check (public.my_role() = 'admin' and source = 'phone' and created_by = auth.uid());

drop policy if exists b2b_sales_update on public.b2b_sales;
create policy b2b_sales_update on public.b2b_sales
  for update using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
