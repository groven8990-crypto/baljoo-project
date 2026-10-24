# 모바일 주문 알림 (1단계)

발주 자동화(PC)와 **별개로**, 쇼핑몰 API에서 주문을 직접 가져와 폰으로 알림을 보냅니다.
샵마인은 외부 연동 API가 확인되지 않아, 샵마인이 주문을 모아 오는 쇼핑몰(쿠팡 · 네이버 등)에 직접 연결합니다.

```
[쿠팡 · 네이버 API] ←5분마다― [Supabase Edge Function: collect-orders]
                                   │ 새 주문만 저장 (orders)
                                   └→ 웹 푸시 → [폰 앱: src/mobile, GitHub Pages]
```

| 위치 | 내용 |
|---|---|
| `supabase/migrations/…_mobile_orders.sql` | 팀원 권한 · 쇼핑몰 계정 · 주문 · 푸시 구독 테이블 (RLS 켜짐) |
| `supabase/functions/collect-orders` | 5분마다 실행되는 주문 수집 + 푸시 |
| `supabase/functions/_shared/coupang.ts` · `naver.ts` | 쇼핑몰별 주문 조회 (11번가 · 지마켓/옥션은 키 발급 후 추가) |
| `supabase/schedule.sql` | 5분 예약 실행 등록 |
| `../src/mobile/` | 폰에 설치하는 앱 (로그인 · 오늘 주문 · 실시간 갱신 · 알림 켜기) |

## 설정 순서

1. **테이블 만들기** — Supabase SQL Editor 에서 `migrations/…_mobile_orders.sql` 실행
2. **VAPID 키 만들기** — `npx web-push generate-vapid-keys`
3. **비밀값 등록** — Supabase → Edge Functions → Secrets
   - `CRON_SECRET` (아무 긴 문자열), `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:메일주소`)
   - 쿠팡: `COUPANG_<REF>_ACCESS_KEY`, `COUPANG_<REF>_SECRET_KEY`, `COUPANG_<REF>_VENDOR_ID`
   - 네이버: `NAVER_<REF>_CLIENT_ID`, `NAVER_<REF>_CLIENT_SECRET`
4. **함수 배포** — `supabase functions deploy collect-orders --no-verify-jwt`
5. **쇼핑몰 계정 등록** (예: 쿠팡 로또상회, 비밀값 이름이 `COUPANG_LOTTO_…` 일 때)
   ```sql
   insert into channel_accounts (id, platform, store_name, business, secret_ref, enabled)
   values ('coupang-lotto', 'coupang', '로또상회', '그로븐', 'LOTTO', true);
   ```
6. **예약 실행** — `schedule.sql` 의 `<PROJECT_REF>`, `<CRON_SECRET>` 을 바꿔서 실행
7. **앱 설정** — `src/mobile/config.js` 에 Supabase 주소 · anon 키 · VAPID 공개키 입력 후 main 에 올리면
   GitHub Pages `…/mobile/` 주소로 배포됩니다
8. **팀원 초대** — Supabase → Authentication → Invite user 로 메일 초대 후
   ```sql
   insert into members (user_id, name, role) values ('<auth.users 의 id>', '대표', 'admin');
   ```

## 동작 메모

- 처음 켠 계정은 최근 2시간 주문을 **알림 없이** 저장만 합니다 (과거 주문이 한꺼번에 울리지 않게).
- 같은 주문은 다시 저장·알림되지 않습니다 (`platform + 주문번호 + 상품주문번호` 중복 제외).
- 개인정보는 이름 마스킹(김**)과 시·군·구까지만 저장합니다.
- 오류는 `channel_accounts.last_error` 에 남습니다.
- 쿠팡 · 네이버 응답 필드는 공식 문서 기준이며, **키 발급 후 실제 응답으로 한 번 검증**이 필요합니다.

## 테스트

```bash
deno test --no-config --node-modules-dir=none mobile/supabase/functions/tests/
```
