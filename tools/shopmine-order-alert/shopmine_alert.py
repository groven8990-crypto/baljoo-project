# -*- coding: utf-8 -*-
"""
샵마인 신규 주문 → 발주 알리미 폰 푸시 (Windows)

샵마인을 켜 둔 PC 에서 실행합니다.
  1) 정해진 간격마다 샵마인 화면에서 [수집하기] → [엑셀파일생성] 을 자동으로 누르고 (setup 에서 기록한 순서대로)
  2) 저장 폴더에 새 샵마인 엑셀이 생기면 서버(shopmine-sync)로 올립니다.
     서버가 처음 보는 주문만 골라 담당자 폰으로 알림을 보냅니다. 파일은 서버에 저장되지 않습니다.

사용법:
  python shopmine_alert.py --setup   처음 1회: 연동 키 · 저장 폴더 · 버튼 위치 기록
  python shopmine_alert.py           감시 시작
  python shopmine_alert.py --test    저장 폴더의 가장 최근 엑셀 1개만 올려 보기

주의:
  - 자동 클릭 중(몇 초)에는 마우스/키보드를 건드리지 마세요
  - 마우스를 화면 왼쪽 위 모서리로 확 움직이면 긴급 중단됩니다 (pyautogui failsafe)
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
CONFIG_FILE = BASE_DIR / "config.json"
SENT_LOG = BASE_DIR / "sent_log.json"

FUNCTION_URL = "https://byanyksnvrqfrkeylvll.supabase.co/functions/v1/shopmine-sync"
EXTS = (".xls", ".xlsx")
FILE_MAX_AGE = 1800   # 이 시간(초) 이내에 저장된 파일만 올림 (기본 30분)
POLL_SEC = 20         # 폴더 확인 주기

DEFAULTS = {
    "sync_key": "",
    "watch_dir": str(Path.home() / "Downloads"),
    "window_title": "ShopMine",  # 샵마인 창 제목: "ShopMine::쇼핑몰 통합관리 솔루션[…]"
    "interval_min": 10,       # 자동 클릭 간격
    "hours": [7, 23],         # 이 시간대에만 자동 클릭 (폴더 감시는 항상)
    "steps": [],              # [{"key": "f5"} | {"click": [x, y]}, ... ] + 각 단계 뒤 "wait" 초
}


def load_config():
    cfg = dict(DEFAULTS)
    if CONFIG_FILE.exists():
        with open(CONFIG_FILE, encoding="utf-8") as f:
            cfg.update(json.load(f))
    return cfg


def save_config(cfg):
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


def load_sent():
    try:
        with open(SENT_LOG, encoding="utf-8") as f:
            return set(json.load(f))
    except Exception:
        return set()


def save_sent(sent):
    with open(SENT_LOG, "w", encoding="utf-8") as f:
        json.dump(sorted(sent)[-500:], f, ensure_ascii=False, indent=1)


def log(msg):
    print(f"[{datetime.now():%H:%M:%S}] {msg}", flush=True)


# ── 서버로 올리기 ─────────────────────────────────────────
def upload(path: Path, key: str):
    req = urllib.request.Request(
        FUNCTION_URL, data=path.read_bytes(), method="POST",
        headers={"x-sync-key": key, "content-type": "application/octet-stream"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        if e.code == 403:
            raise RuntimeError("연동 키가 맞지 않습니다 — python shopmine_alert.py --setup 으로 다시 입력하세요")
        raise RuntimeError(f"서버 오류 {e.code}: {body[:200]}")


def report(path: Path, res: dict):
    if res.get("first_run"):
        log(f"✅ {path.name}: 처음 연결 — 주문 {res['rows']}건 저장 (기존 주문이라 알림은 보내지 않음)")
    else:
        log(f"✅ {path.name}: 주문 {res['rows']}건 중 신규 {res['new']}건 · 폰 알림 {res['pushed']}대")


def recent_files(folder: Path):
    now = time.time()
    files = [p for p in folder.iterdir() if p.suffix.lower() in EXTS and not p.name.startswith("~$")]
    return sorted((p for p in files if now - p.stat().st_mtime <= FILE_MAX_AGE), key=lambda p: p.stat().st_mtime)


def scan_and_upload(cfg, sent):
    folder = Path(cfg["watch_dir"])
    if not folder.exists():
        log(f"⚠ 저장 폴더가 없습니다: {folder}")
        return
    for p in recent_files(folder):
        tag = f"{p.name}|{int(p.stat().st_mtime)}"
        if tag in sent:
            continue
        if time.time() - p.stat().st_mtime < 3:
            continue  # 아직 저장 중일 수 있음 — 다음 확인 때
        try:
            report(p, upload(p, cfg["sync_key"]))
        except RuntimeError as e:
            log(f"⚠ {p.name}: {e}")
            if "연동 키" in str(e):
                return
        sent.add(tag)  # 샵마인 양식이 아닌 엑셀도 다시 올리지 않도록 기록
        save_sent(sent)


# ── 샵마인 자동 클릭 ──────────────────────────────────────
def gui():
    try:
        import pyautogui
        import win32con
        import win32gui
    except ImportError:
        print("자동 클릭에 필요한 패키지가 없습니다. 먼저 실행하세요:")
        print("  pip install pyautogui pywin32")
        sys.exit(1)
    pyautogui.FAILSAFE = True
    pyautogui.PAUSE = 0.3
    return pyautogui, win32con, win32gui


def focus_shopmine(title_part):
    _, win32con, win32gui = gui()
    found = []

    # 설정한 글자가 없어도 샵마인 실제 제목("ShopMine::쇼핑몰 통합관리 솔루션…")으로 한 번 더 찾음
    names = [n for n in (title_part, "ShopMine", "샵마인") if n]

    def cb(hwnd, _):
        title = win32gui.GetWindowText(hwnd)
        if win32gui.IsWindowVisible(hwnd) and any(n.lower() in title.lower() for n in names):
            found.append(hwnd)
    win32gui.EnumWindows(cb, None)
    if not found:
        return False
    hwnd = found[0]
    if win32gui.IsIconic(hwnd):
        win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
    try:
        win32gui.SetForegroundWindow(hwnd)
    except Exception:
        pass
    time.sleep(0.8)
    return True


def run_steps(cfg):
    pyautogui, _, _ = gui()
    if not focus_shopmine(cfg["window_title"]):
        log(f"⚠ 제목에 '{cfg['window_title']}' 이(가) 들어간 창을 못 찾았습니다 — 샵마인이 켜져 있는지 확인하세요")
        return
    log("🖱 샵마인 자동 수집 중 — 마우스를 잠시 건드리지 마세요")
    for s in cfg["steps"]:
        if "key" in s:
            pyautogui.press(s["key"])
        elif "click" in s:
            pyautogui.click(*s["click"])
        time.sleep(s.get("wait", 3))


def setup():
    cfg = load_config()
    print("=== 발주 알리미 · 샵마인 연동 설정 ===\n")
    k = input(f"1) 연동 키 (발주 자동화와 같은 키){' [그대로 두려면 Enter]' if cfg['sync_key'] else ''}: ").strip()
    if k:
        cfg["sync_key"] = k
    d = input(f"2) 샵마인 엑셀이 저장되는 폴더 [{cfg['watch_dir']}]: ").strip().strip('"')
    if d:
        cfg["watch_dir"] = d
    t = input(f"3) 샵마인 창 제목에 들어가는 글자 [{cfg['window_title']}]: ").strip()
    if t:
        cfg["window_title"] = t

    if input("\n4) 샵마인 버튼을 자동으로 누르게 할까요? (y/n) [y]: ").strip().lower() in ("", "y"):
        pyautogui, _, _ = gui()
        steps = []
        if input("   먼저 F5(수집하기) 키를 누를까요? (y/n) [y]: ").strip().lower() in ("", "y"):
            w = input("   수집이 끝날 때까지 기다릴 초 [60]: ").strip()
            steps.append({"key": "f5", "wait": int(w or 60)})
        print("\n   이제 누를 버튼을 순서대로 기록합니다 (예: 엑셀파일생성 → 저장/확인).")
        print("   샵마인 화면에서 버튼 위에 마우스를 올려 두고, 이 창을 클릭하지 말고 키보드로 Enter 를 누르세요.")
        while True:
            a = input(f"   [{len(steps) + 1}번째] 버튼 위에 마우스 → Enter (끝이면 q): ").strip().lower()
            if a == "q":
                break
            x, y = pyautogui.position()
            w = input(f"     ({x}, {y}) 기록 — 누른 뒤 기다릴 초 [5]: ").strip()
            steps.append({"click": [x, y], "wait": int(w or 5)})
        cfg["steps"] = steps
        m = input(f"\n5) 몇 분마다 자동으로 누를까요? [{cfg['interval_min']}]: ").strip()
        if m:
            cfg["interval_min"] = int(m)
    else:
        cfg["steps"] = []
    save_config(cfg)
    print(f"\n저장했습니다: {CONFIG_FILE}")
    print("이제 python shopmine_alert.py 로 시작하세요.")


def watch():
    cfg = load_config()
    if not cfg["sync_key"]:
        print("먼저 설정하세요:  python shopmine_alert.py --setup")
        sys.exit(1)
    sent = load_sent()
    log(f"👀 시작 — 저장 폴더: {cfg['watch_dir']}")
    if cfg["steps"]:
        log(f"   샵마인 자동 수집: {cfg['interval_min']}분마다 ({cfg['hours'][0]}시~{cfg['hours'][1]}시)")
    else:
        log("   자동 클릭 없음 — 샵마인에서 엑셀을 저장할 때마다 알림이 갑니다")
    log("   (종료: Ctrl+C / 긴급중단: 마우스를 화면 왼쪽 위 모서리로)")
    next_run = 0.0
    while True:
        try:
            h = datetime.now().hour
            if cfg["steps"] and time.time() >= next_run and cfg["hours"][0] <= h < cfg["hours"][1]:
                run_steps(cfg)
                next_run = time.time() + cfg["interval_min"] * 60
            scan_and_upload(cfg, sent)
        except KeyboardInterrupt:
            log("종료")
            return
        except Exception as e:
            if type(e).__name__ == "FailSafeException":
                log("🛑 긴급 중단됨 (failsafe)")
                return
            log(f"⚠ 오류: {e}")
        time.sleep(POLL_SEC)


def test():
    cfg = load_config()
    folder = Path(cfg["watch_dir"])
    files = sorted((p for p in folder.iterdir() if p.suffix.lower() in EXTS), key=lambda p: p.stat().st_mtime)
    if not files:
        print(f"엑셀 파일이 없습니다: {folder}")
        return
    p = files[-1]
    print(f"올리는 파일: {p}")
    report(p, upload(p, cfg["sync_key"]))


if __name__ == "__main__":
    arg = sys.argv[1] if len(sys.argv) > 1 else ""
    if arg == "--setup":
        setup()
    elif arg == "--test":
        test()
    else:
        watch()
