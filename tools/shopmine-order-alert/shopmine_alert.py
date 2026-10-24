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
    "window_proc": "",           # 샵마인 프로그램 파일 이름 (설정 3번에서 창을 클릭해 기록)
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


APP_VERSION = "2026-10-24e"


def proc_name(hwnd):
    """창을 띄운 프로그램 파일 이름 (예: ShopMine.exe). 관리자 권한으로 켜진 프로그램도 읽히도록 최소 권한으로 엶"""
    import ctypes
    import win32process
    try:
        _, pid = win32process.GetWindowThreadProcessId(hwnd)
        k32 = ctypes.windll.kernel32
        h = k32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not h:
            return ""
        try:
            buf = ctypes.create_unicode_buffer(1024)
            size = ctypes.c_ulong(1024)
            if k32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(size)):
                return os.path.basename(buf.value)
        finally:
            k32.CloseHandle(h)
    except Exception:
        pass
    return ""


def visible_windows():
    _, _, win32gui = gui()
    out = []

    def cb(hwnd, _):
        if win32gui.IsWindowVisible(hwnd) and win32gui.GetWindowText(hwnd).strip():
            out.append((hwnd, win32gui.GetWindowText(hwnd), proc_name(hwnd)))
    win32gui.EnumWindows(cb, None)
    return out


def find_shopmine(cfg):
    # 창 제목 · 프로그램 이름 중 하나라도 맞으면 샵마인으로 봄 (제목이 프로그램 안에서 따로 그려지는 경우 대비)
    names = [n.lower() for n in (cfg.get("window_title"), "ShopMine", "샵마인") if n]
    procs = [p.lower() for p in (cfg.get("window_proc"), "shopmine") if p]
    # 이 프로그램을 띄운 검은 창(제목에 "...shopmine_alert.py" 가 들어감)은 제외
    skip = ("cmd.exe", "windowsterminal.exe", "conhost.exe", "powershell.exe", "pwsh.exe",
            "openconsole.exe", "python.exe", "pythonw.exe", "explorer.exe")
    wins = [w for w in visible_windows() if w[2].lower() not in skip and "shopmine_alert" not in w[1].lower()]
    for hwnd, title, proc in wins:  # 프로그램 이름이 맞는 창을 먼저
        if any(p in proc.lower() for p in procs):
            return hwnd
    for hwnd, title, proc in wins:
        if any(n in title.lower() for n in names):
            return hwnd
    return None


def focus_shopmine(cfg):
    """샵마인 창을 찾아 최대화해서 맨 앞으로. 창 왼쪽 위 좌표를 돌려줌 (못 찾으면 None)
    — 버튼 위치는 창 기준으로 기록하므로, 창이 어디로 옮겨져 있어도 같은 버튼을 누름"""
    _, win32con, win32gui = gui()
    hwnd = find_shopmine(cfg)
    if not hwnd:
        return None
    win32gui.ShowWindow(hwnd, win32con.SW_MAXIMIZE)
    try:
        win32gui.SetForegroundWindow(hwnd)
    except Exception:
        pass
    time.sleep(1.0)
    left, top, _, _ = win32gui.GetWindowRect(hwnd)
    return left, top


def report_windows():
    log("   지금 열려 있는 창 (제목 | 프로그램) — 이 화면을 캡처해서 보내주세요:")
    for _, title, proc in visible_windows()[:20]:
        log(f"     {title[:50]} | {proc}")


def run_steps(cfg):
    pyautogui, _, _ = gui()
    origin = focus_shopmine(cfg)
    if not origin:
        log("⚠ 샵마인 창을 못 찾았습니다 — 샵마인이 켜져 있는지 확인하세요")
        report_windows()
        return
    log("🖱 샵마인 자동 수집 중 — 마우스를 잠시 건드리지 마세요")
    for s in cfg["steps"]:
        if "key" in s:
            pyautogui.press(s["key"])
        elif "click_rel" in s:
            pyautogui.click(origin[0] + s["click_rel"][0], origin[1] + s["click_rel"][1])
        elif "click" in s:  # 예전 설정(화면 절대 좌표)
            pyautogui.click(*s["click"])
        time.sleep(s.get("wait", 3))


def setup():
    self_update()
    cfg = load_config()
    print("=== 발주 알리미 · 샵마인 연동 설정 ===\n")
    k = input(f"1) 연동 키 (발주 자동화와 같은 키){' [그대로 두려면 Enter]' if cfg['sync_key'] else ''}: ").strip()
    if k:
        cfg["sync_key"] = k
    d = input(f"2) 샵마인 엑셀이 저장되는 폴더 [{cfg['watch_dir']}]: ").strip().strip('"')
    if d:
        cfg["watch_dir"] = d
    if input("3) 샵마인 창을 지금 지정할까요? (y/n) [y]: ").strip().lower() in ("", "y"):
        _, _, win32gui = gui()
        print("   5초 안에 샵마인 창을 마우스로 한 번 클릭해서 맨 앞으로 두세요...")
        for i in range(5, 0, -1):
            print(f"   {i}...", flush=True)
            time.sleep(1)
        hwnd = win32gui.GetForegroundWindow()
        title, proc = win32gui.GetWindowText(hwnd), proc_name(hwnd)
        print(f"   기록: {title[:40]} | {proc}")
        if proc and proc.lower() not in ("cmd.exe", "windowsterminal.exe", "conhost.exe", "powershell.exe"):
            cfg["window_proc"] = proc
            cfg["window_title"] = title[:20] or cfg["window_title"]
        else:
            print("   ⚠ 이 검은 창이 기록됐습니다. 샵마인 창을 클릭하지 않은 것 같아요 — 기본값으로 둡니다")

    if input("\n4) 샵마인 버튼을 자동으로 누르게 할까요? (y/n) [y]: ").strip().lower() in ("", "y"):
        pyautogui, _, _ = gui()
        steps = []
        if input("   먼저 F5(수집하기) 키를 누를까요? (y/n) [y]: ").strip().lower() in ("", "y"):
            w = input("   수집이 끝날 때까지 기다릴 초 [60]: ").strip()
            steps.append({"key": "f5", "wait": int(w or 60)})
        print("\n   이제 누를 버튼을 순서대로 기록합니다 (예: 엑셀파일생성 → 저장/확인).")
        _, _, win32gui = gui()
        me = win32gui.GetForegroundWindow()  # 이 검은 창 — 샵마인을 키운 뒤 다시 앞으로 가져와 Enter 를 받기 위해
        origin = focus_shopmine(cfg)
        if not origin:
            print("   ⚠ 샵마인 창을 못 찾았습니다. 샵마인을 켠 뒤 설정을 다시 실행해 주세요.")
            report_windows()
            return
        try:
            win32gui.SetForegroundWindow(me)
        except Exception:
            pass
        print("   샵마인 창을 화면 가득 키웠습니다 (자동 수집 때도 똑같이 키운 뒤 누릅니다).")
        print("   샵마인 버튼 위에 마우스를 올려 두고(클릭 X), 키보드 Enter 를 '한 번' 누르세요.")
        while True:
            a = input(f"   [{len(steps) + 1}번째] 버튼 위에 마우스 → Enter (끝이면 q): ").strip().lower()
            if a == "q":
                break
            x, y = pyautogui.position()
            w = input(f"     ({x}, {y}) 기록 — 누른 뒤 기다릴 초 [5]: ").strip()
            steps.append({"click_rel": [x - origin[0], y - origin[1]], "wait": int(w or 5)})
            print("     ※ 버튼이 하나 더 있을 때만 다음 버튼 위에 마우스 → Enter, 없으면 q")
        cfg["steps"] = steps
        m = input(f"\n5) 몇 분마다 자동으로 누를까요? [{cfg['interval_min']}]: ").strip()
        if m:
            cfg["interval_min"] = int(m)
    else:
        cfg["steps"] = []
    save_config(cfg)
    print(f"\n저장했습니다: {CONFIG_FILE}")
    print("이제 python shopmine_alert.py 로 시작하세요.")


UPDATE_URL = "https://groven8990-crypto.github.io/baljoo-project/pc/shopmine_alert.py"


def self_update():
    """켤 때마다 최신 프로그램을 받아 보고, 바뀌었으면 자기 파일을 바꾸고 다시 시작 (다시 설치할 필요 없게)"""
    try:
        import random
        req = urllib.request.Request(f"{UPDATE_URL}?v={random.randint(1, 10**9)}", headers={"Cache-Control": "no-cache"})
        with urllib.request.urlopen(req, timeout=15) as r:
            new = r.read()
        me = Path(__file__).resolve()
        if b"def watch()" in new and new != me.read_bytes():
            me.write_bytes(new)
            log("⬆ 새 버전을 받았습니다 — 다시 시작합니다")
            import subprocess
            sys.exit(subprocess.call([sys.executable, str(me)] + sys.argv[1:]))
    except Exception as e:
        log(f"   (업데이트 확인 건너뜀: {e})")


def watch():
    self_update()
    cfg = load_config()
    if not cfg["sync_key"]:
        print("먼저 설정하세요:  python shopmine_alert.py --setup")
        sys.exit(1)
    sent = load_sent()
    log(f"👀 시작 ({APP_VERSION}) — 저장 폴더: {cfg['watch_dir']}")
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
    elif arg == "--windows":
        report_windows()
    else:
        watch()
