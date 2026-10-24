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
| `supabase/migrations/…_b2b_sales.sql` | 문자매출(직거래) 테이블 — 폰 · 발주 사이트 공용 |
| `supabase/functions/b2b-sync` | 발주 사이트 '직거래 주문 추가' → 문자매출 저장 |
| `supabase/migrations/…_report_snapshots.sql` · `functions/report-sync` | 발주 자동화가 만든 매출 보고서(매출 · 매입 · 수수료 · 부가세 · 순이익)를 받아 현황 · 보고서 · 순마진 화면에 씀 |
| `supabase/dashboard/` | 대시보드에 그대로 붙여 넣는 설정 파일 (`setup.sql` · 함수 한 파일본) |
| `supabase/functions/shopmine-sync` · `../tools/shopmine-order-alert` | 샵마인 엑셀 → 신규 주문만 저장 · 푸시 (PC 스크립트가 샵마인 자동 수집 후 업로드) |
| `../src/mobile/` | 폰 앱 — 현황 · 보고서 · 순마진 (공통) + B2B · CS (담당자) · 설정 |

## 설정 순서

### 오늘 바로 쓰기 (문자매출 · 현황 · 보고서 · 순마진) — 대시보드에서 3가지
1. **계정 만들기** — Authentication → Users → Add user → 이메일 · 비밀번호 입력, **Auto Confirm User 체크**
   (팀원도 같은 방법으로 만들고, 아래 SQL 의 이메일 · 이름 · 권한만 바꿔 실행)
2. **SQL 한 번 실행** — SQL Editor → New query 에 `dashboard/setup.sql` 전체를 붙여 넣고,
   맨 아래 `'여기에-이메일'` 을 1번 이메일로 바꿔 Run → 결과 표의 **sync_key** 값을 복사
3. **함수 2개 만들기** — Edge Functions → Deploy a new function → Via Editor 에
   `dashboard/b2b-sync.ts`(이름 `b2b-sync`), `dashboard/report-sync.ts`(이름 `report-sync`) 를 각각 붙여 넣고 배포,
   각 함수 Details 에서 **Verify JWT 끄기**

그다음 발주 자동화 → 직거래 주문 카드의 `📱 모바일 앱 연동 [연동 키 입력]` 에 sync_key 를 붙여 넣으면,
직거래 주문과 매출 보고서(보고서 생성 = 진행 중, '💾 이력에 저장' = 마감 확정)가 자동으로 폰 앱에 올라갑니다.

폰 앱 주소: `https://groven8990-crypto.github.io/baljoo-project/mobile/` (main 에 합쳐지면 GitHub Pages 로 배포)
아이폰은 Safari → 공유 → 홈 화면에 추가, 안드로이드는 Chrome → 설치

팀원 추가 SQL (권한: `admin` 담당자 · `staff` 실무 · `viewer` 보기 전용):
```sql
insert into members (user_id, name, role)
select id, '이름', 'viewer' from auth.users where email = '팀원이메일'
on conflict (user_id) do update set name = excluded.name, role = excluded.role;
```

### 신규 주문 푸시 — 샵마인 (지금 방식)
1. 웹 푸시 키는 `app_secrets` 에 `VAPID_PUBLIC_KEY` · `VAPID_PRIVATE_KEY` · `VAPID_SUBJECT` 로 넣고, 공개키는 `src/mobile/config.js` 에도 입력
2. `shopmine-sync` 배포 (Verify JWT 끄기), 마이그레이션 `…_shopmine_orders.sql`
3. 샵마인 PC 에서 `tools/shopmine-order-alert` 설정 · 실행 (그 폴더 README)
4. 폰 앱 → 톱니바퀴 → **신규 주문 알림 켜기**

### 나중에 — 쇼핑몰 API 직접 연동 (고정 IP 필요)
1. VAPID 키 만들기 — `npx web-push generate-vapid-keys`, 공개키는 `src/mobile/config.js` 에도 입력
2. Edge Functions → Secrets: `CRON_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`(`mailto:메일주소`),
   쿠팡 `COUPANG_<REF>_ACCESS_KEY` · `_SECRET_KEY` · `_VENDOR_ID`, 네이버 `NAVER_<REF>_CLIENT_ID` · `_CLIENT_SECRET`
3. `collect-orders` 배포 (`supabase functions deploy collect-orders --no-verify-jwt`)
4. 쇼핑몰 계정 등록 (예: 비밀값 이름이 `COUPANG_LOTTO_…` 일 때)
   ```sql
   insert into channel_accounts (id, platform, store_name, business, secret_ref, enabled)
   values ('coupang-lotto', 'coupang', '로또상회', '그로븐', 'LOTTO', true);
   ```
5. `schedule.sql` 의 `<PROJECT_REF>`, `<CRON_SECRET>` 을 바꿔 실행 (5분마다 수집)

## 동작 메모

- 처음 켠 계정은 최근 2시간 주문을 **알림 없이** 저장만 합니다 (과거 주문이 한꺼번에 울리지 않게).
- 같은 주문은 다시 저장·알림되지 않습니다 (`platform + 주문번호 + 상품주문번호` 중복 제외).
- 개인정보는 이름 마스킹(김**)과 시·군·구까지만 저장합니다.
- 오류는 `channel_accounts.last_error` 에 남습니다.
- 문자매출: 발주 사이트의 '제거'는 발주처 전달 후 목록 정리용이라 **서버 매출은 지우지 않습니다**. 매출 삭제는 폰 앱 B2B 탭의 × 로 합니다 (지우지 않고 deleted_at 표시).
- 발주 사이트에서 보낸 건은 주문번호로 덮어쓰므로 재전송해도 두 번 잡히지 않습니다. 폰과 사이트 양쪽에 같은 품목 · 금액을 넣으면 폰에서 한 번 더 확인합니다.
- 매출 보고: 이미 '마감 확정'된 날짜는 보고서를 다시 만들어도 '진행 중'으로 되돌아가지 않습니다 — 고친 숫자를 반영하려면 다시 '이력에 저장'.
- 폰 화면의 매출 · 순이익은 발주 자동화 보고서 숫자 + 폰에서 넣은 문자매출입니다 (발주 사이트에서 넣은 직거래는 보고서에 이미 들어 있어 두 번 더하지 않음).
- 인터넷이 끊겨 못 보낸 직거래 주문은 발주 자동화를 다시 열 때 최근 7일치를 자동 재전송합니다.
- 쿠팡 · 네이버 응답 필드는 공식 문서 기준이며, **키 발급 후 실제 응답으로 한 번 검증**이 필요합니다.

## 테스트

```bash
deno test --no-config --node-modules-dir=none mobile/supabase/functions/tests/
node mobile/tests/report.test.mjs   # 폰 화면 계산 (10/21 실제 보고서 숫자로 검증)
```
