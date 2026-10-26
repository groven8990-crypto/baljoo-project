#!/usr/bin/env bash
# 발주 알리미 주문 수집기 — 오라클 무료 서버(Ubuntu)에 설치
#   설치:      curl -fsSL https://groven8990-crypto.github.io/baljoo-project/vm/install.sh | sudo bash
#   키 다시 입력: sudo baljoo-setup
#   지금 결과 보기: baljoo-log
set -euo pipefail
BASE="https://groven8990-crypto.github.io/baljoo-project/vm"
APP=/opt/baljoo
CONF=/etc/baljoo
DENO_VER=v2.1.4

[ "$(id -u)" = 0 ] || { echo "sudo 로 실행해 주세요"; exit 1; }
exec 3</dev/tty   # curl | bash 로 실행해도 키보드 입력을 받기 위해

ask() {     # ask 변수 "질문" [숨김]
  local v
  if [ "${3:-}" = hide ]; then read -r -s -u 3 -p "$2" v; echo; else read -r -u 3 -p "$2" v; fi
  v="${v//[[:space:]\']/}"   # 붙여넣을 때 섞인 공백 · 따옴표 제거
  printf -v "$1" '%s' "$v"
}

echo "▶ 1/4 프로그램 설치"
if ! command -v deno >/dev/null || [ "$(deno --version | head -1 | cut -d' ' -f2)" != "${DENO_VER#v}" ]; then
  apt-get update -qq && apt-get install -y -qq unzip curl >/dev/null
  curl -fsSL -o /tmp/deno.zip "https://github.com/denoland/deno/releases/download/${DENO_VER}/deno-x86_64-unknown-linux-gnu.zip"
  unzip -o -q /tmp/deno.zip -d /usr/local/bin && rm /tmp/deno.zip
fi
mkdir -p "$APP/shared" "$CONF" /var/cache/baljoo
cat > "$APP/update.sh" <<EOF
#!/usr/bin/env bash
# 실행할 때마다 최신 수집 프로그램을 받아 옴 (실패하면 가지고 있던 것으로 실행)
set -e
t=\$(mktemp -d)
for f in collector.ts shared/types.ts shared/naver.ts shared/coupang.ts install.sh; do
  mkdir -p "\$t/\$(dirname \$f)"
  curl -fsSL --max-time 20 -o "\$t/\$f" "$BASE/\$f?t=\$(date +%s)"
done
cp -r "\$t"/. "$APP"/ && rm -rf "\$t"
EOF
chmod +x "$APP/update.sh"
"$APP/update.sh"
ln -sf "$APP/install.sh" /usr/local/bin/baljoo-setup && chmod +x "$APP/install.sh"
printf '#!/bin/sh\njournalctl -u baljoo-collector -n 40 --no-pager -o cat\n' > /usr/local/bin/baljoo-log
chmod +x /usr/local/bin/baljoo-log

echo "▶ 2/4 키 입력 (입력한 키는 이 서버에만 저장되고 화면에 보이지 않습니다)"
if [ -s "$CONF/env" ] && [ "${1:-}" != "--reset" ] && [ "$0" != /usr/local/bin/baljoo-setup ]; then
  echo "  이미 입력된 키가 있어 그대로 씁니다. (다시 입력: sudo baljoo-setup)"
else
  ask SYNC "  발주 알리미 연동 키: " hide
  ENV="BALJOO_SYNC_KEY='$SYNC'"$'\n'
  ACC=""
  add_acc() { ACC="$ACC${ACC:+,}{\"id\":\"$1\",\"platform\":\"$2\",\"store_name\":\"$3\",\"ref\":\"$4\"}"; }
  for S in "로또상회:LOTTO:lotto" "자꾸가게:JAKKU:jakku"; do
    IFS=: read -r NAME REF ID <<<"$S"
    echo
    echo "  [네이버 · $NAME] 커머스API센터의 애플리케이션 ID / 시크릿 (없으면 그냥 Enter)"
    ask NID "    애플리케이션 ID: "
    if [ -n "$NID" ]; then
      ask NSEC "    애플리케이션 시크릿: " hide
      ENV+="NAVER_${REF}_CLIENT_ID='$NID'"$'\n'"NAVER_${REF}_CLIENT_SECRET='$NSEC'"$'\n'
      add_acc "naver-$ID" naver "$NAME" "$REF"
    fi
    echo "  [쿠팡 · $NAME] Wing 판매자정보의 OPEN API 키 (없으면 그냥 Enter)"
    ask VID "    업체코드(Vendor ID, A로 시작): "
    if [ -n "$VID" ]; then
      ask AK "    Access Key: " hide
      ask SK "    Secret Key: " hide
      ENV+="COUPANG_${REF}_VENDOR_ID='$VID'"$'\n'"COUPANG_${REF}_ACCESS_KEY='$AK'"$'\n'"COUPANG_${REF}_SECRET_KEY='$SK'"$'\n'
      add_acc "coupang-$ID" coupang "$NAME" "$REF"
    fi
  done
  umask 077
  printf '%s' "$ENV" > "$CONF/env"
  echo "[$ACC]" > "$CONF/accounts.json"
  chmod 600 "$CONF/env" "$CONF/accounts.json"
fi

echo "▶ 3/4 5분마다 자동 실행 등록"
cat > /etc/systemd/system/baljoo-collector.service <<EOF
[Unit]
Description=발주 알리미 주문 수집
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
EnvironmentFile=$CONF/env
Environment=DENO_DIR=/var/cache/baljoo
Environment=DENO_NO_UPDATE_CHECK=1
ExecStartPre=-$APP/update.sh
ExecStart=/usr/local/bin/deno run --allow-net --allow-env --allow-read --allow-write=/var/cache/baljoo $APP/collector.ts
TimeoutStartSec=240
EOF
cat > /etc/systemd/system/baljoo-collector.timer <<EOF
[Unit]
Description=발주 알리미 주문 수집 (5분마다)

[Timer]
OnBootSec=1min
OnCalendar=*:0/5
Persistent=true

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now baljoo-collector.timer >/dev/null

echo "▶ 4/4 첫 수집 실행 (1분 정도 걸릴 수 있습니다)"
systemctl start baljoo-collector.service || true
journalctl -u baljoo-collector -n 15 --no-pager -o cat | grep -E "✅|⚠️|error|Error" || true
echo
echo "완료! 이제 5분마다 자동으로 주문을 확인합니다. 창을 닫아도 됩니다."
echo "결과 다시 보기: baljoo-log   ·   키 다시 입력: sudo baljoo-setup"
