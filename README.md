# 발주 자동화 (Baljoo Automation)

샵마인 발송대기 엑셀을 발주처별 발주서로 자동 변환하는 데스크톱 앱.

## 구성

- **`src/index.html`** — 앱 본체 (UI + 모든 기능)
- **`src/vendor/`** — 오프라인 사용을 위한 라이브러리 (xlsx, chart.js, html2canvas)
- **`src/main.js`** — Electron 메인 프로세스
- **`package.json`** — 빌드 설정 (electron-builder)
- **`.github/workflows/build.yml`** — Windows `.exe` 자동 빌드

## Windows `.exe` 받는 법 (자동 빌드)

1. 이 저장소를 GitHub에 푸시합니다 (이미 `claude/zen-fermi-FYRrh` 브랜치에 있음).
2. GitHub 저장소 → **Actions** 탭 → **Build Desktop App** 워크플로우를 엽니다.
3. 최신 실행을 클릭하고 **Artifacts** 섹션에서 `baljoo-windows`를 다운로드합니다.
4. 압축을 풀면 두 가지 파일이 있습니다:
   - **`발주 자동화-Setup-2.2.0.exe`** — 설치형 (바탕화면 바로가기 자동 생성)
   - **`발주 자동화-Portable-2.2.0.exe`** — 설치 없이 더블클릭으로 실행

### 정식 릴리스 만들기

```bash
git tag v2.2.0
git push origin v2.2.0
```
태그를 푸시하면 GitHub Releases 페이지에 `.exe`가 자동으로 첨부됩니다.

## 로컬에서 직접 실행/빌드 (선택)

Node.js 20+ 필요.

```bash
npm install
npm start            # 개발 모드 실행
npm run build:win    # Windows .exe 빌드 (dist/ 폴더에 생성)
```

## 업데이트 방식 (하이브리드)

### HTML 수정만 했을 때 (대부분의 경우) — 빠른 갱신
1. `index.html` 수정 → `.bat`로 `main` 브랜치에 푸시
2. 사용자는 앱에서 **Ctrl+R (또는 메뉴 > 보기 > 새로 고침)** 한 번
3. 즉시 최신 HTML 반영 — `.exe` 재다운로드 불필요

원리: 앱이 시작될 때마다 `https://raw.githubusercontent.com/groven8990-crypto/baljoo-project/main/src/index.html`을 받아옵니다. 오프라인이면 마지막에 받은 캐시 버전이 사용됩니다.

### Electron 자체 변경 (드물게) — 자동 업데이트
1. `package.json`의 버전 올림 → 태그 푸시 (예: `git tag v2.4.0 && git push --tags`)
2. GitHub Actions가 자동으로 새 `.exe`를 빌드 + Release 발행
3. 사용자 앱이 시작 5초 후 자동으로 감지 → 백그라운드 다운로드 → 알림 표시
4. 사용자가 "지금 재시작" 클릭하면 갱신 완료

## 오프라인 동작

- 엑셀 처리, 발주서 생성, 송장, 정산 등 **모든 핵심 기능은 인터넷 없이 작동**합니다.
- 헤더의 **🔄 재동기화** (여러 PC 간 코드 공유)만 인터넷 연결을 필요로 합니다.
- 인터넷이 끊겨도 앱은 마지막에 받은 HTML 캐시로 정상 동작합니다.

## 데이터 저장 위치

사용자 데이터는 Electron의 `userData` 폴더에 `localStorage` / `IndexedDB`로 저장됩니다.
- Windows: `%APPDATA%\발주 자동화\`
