# 오라클 서버 주문 수집기 (쿠팡 · 네이버)

쿠팡 · 네이버 API 는 등록한 IP 에서만 열리므로, 고정 IP 를 가진 오라클 무료 서버에서 5분마다 주문을 조회해
발주 알리미 서버(`market-ingest`)로 보냅니다. 저장 · 중복 제거 · 폰 알림은 서버가 합니다.

- 설치 (서버 터미널): `curl -fsSL https://groven8990-crypto.github.io/baljoo-project/vm/install.sh | sudo bash`
- 키 다시 입력: `sudo baljoo-setup` · 최근 결과: `baljoo-log`
- 쇼핑몰 키는 서버의 `/etc/baljoo/env`(권한 600)에만 저장됩니다. 저장소 · 채팅에 올리지 마세요.
- 조회 코드는 `mobile/supabase/functions/_shared/{naver,coupang}.ts` 를 그대로 씁니다 (Pages 배포 시 `vm/shared/` 로 복사).
- 실행할 때마다 최신 코드를 받아 옵니다. 받기에 실패하면 가지고 있던 코드로 실행합니다.
