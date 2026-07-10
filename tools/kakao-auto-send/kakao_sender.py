# -*- coding: utf-8 -*-
"""
발주서 카카오톡 자동 전송 스크립트 (Windows 전용)

발주 앱에서 다운로드한 발주서 파일(YYMMDD-발주처-발주서_사업자.xlsx)을 감시하다가
rooms.json 에 매핑된 카톡 채팅방으로 자동 첨부 전송합니다.

사용법:
  1) pip install pyautogui pyperclip pywin32
  2) rooms.json 에 발주처별 채팅방 이름 등록
  3) PC 카카오톡 로그인 상태에서 실행:  python kakao_sender.py
     (특정 파일 하나만 보내려면:       python kakao_sender.py --once "파일경로.xlsx")

주의:
  - 전송 중에는 마우스/키보드를 건드리지 마세요 (화면을 직접 조작합니다)
  - 마우스를 화면 왼쪽 위 모서리로 확 움직이면 긴급 중단됩니다 (pyautogui failsafe)
"""

import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

try:
    import pyautogui
    import pyperclip
    import win32con
    import win32gui
except ImportError:
    print("필수 패키지가 없습니다. 먼저 실행하세요:")
    print("  pip install pyautogui pyperclip pywin32")
    sys.exit(1)

pyautogui.FAILSAFE = True  # 마우스를 (0,0) 모서리로 이동하면 즉시 중단
pyautogui.PAUSE = 0.3

BASE_DIR = Path(__file__).resolve().parent
ROOMS_FILE = BASE_DIR / "rooms.json"
SENT_LOG = BASE_DIR / "sent_log.json"

# 발주 앱 파일명 패턴: 260710-일비-발주서_그로븐.xlsx
FILENAME_RE = re.compile(r"^(\d{6})-(.+?)-발주서_(.+?)\.xlsx$")

# 감시할 폴더 (기본: 사용자 다운로드 폴더)
WATCH_DIR = Path(os.environ.get("KAKAO_SENDER_WATCH_DIR", Path.home() / "Downloads"))

POLL_SEC = 3          # 폴더 확인 주기
FILE_MAX_AGE = 600    # 이 시간(초) 이내에 만들어진 파일만 전송 (기본 10분)


def load_rooms():
    if not ROOMS_FILE.exists():
        print(f"rooms.json 이 없습니다: {ROOMS_FILE}")
        print('예시: { "일비": "일비 발주", "최고집": "최고집 사장님" }')
        sys.exit(1)
    with open(ROOMS_FILE, encoding="utf-8") as f:
        return json.load(f)


def load_sent():
    try:
        with open(SENT_LOG, encoding="utf-8") as f:
            return set(json.load(f))
    except Exception:
        return set()


def save_sent(sent):
    with open(SENT_LOG, "w", encoding="utf-8") as f:
        json.dump(sorted(sent)[-500:], f, ensure_ascii=False, indent=1)


def copy_file_to_clipboard(path: Path):
    """파일 자체를 클립보드에 복사 (탐색기에서 Ctrl+C 한 것과 동일)"""
    cmd = [
        "powershell", "-NoProfile", "-Command",
        f'Set-Clipboard -LiteralPath "{path}"',
    ]
    subprocess.run(cmd, check=True, creationflags=subprocess.CREATE_NO_WINDOW)


def find_window(title):
    hwnd = win32gui.FindWindow(None, title)
    return hwnd if hwnd else None


def focus(hwnd):
    if win32gui.IsIconic(hwnd):
        win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
    win32gui.SetForegroundWindow(hwnd)
    time.sleep(0.5)


def open_chatroom(room_name: str):
    """채팅방 창이 이미 열려있으면 그걸 쓰고, 없으면 메인창 검색으로 연다"""
    hwnd = find_window(room_name)
    if hwnd:
        focus(hwnd)
        return hwnd

    main = find_window("카카오톡")
    if not main:
        raise RuntimeError("PC 카카오톡이 실행되어 있지 않습니다. 로그인 후 다시 실행하세요.")
    focus(main)

    # Ctrl+F 검색 → 채팅방 이름 붙여넣기 → Enter
    pyautogui.hotkey("ctrl", "f")
    time.sleep(0.5)
    pyperclip.copy(room_name)
    pyautogui.hotkey("ctrl", "v")
    time.sleep(1.0)
    pyautogui.press("enter")
    time.sleep(1.5)

    hwnd = find_window(room_name)
    if not hwnd:
        raise RuntimeError(f"채팅방 '{room_name}' 을 열지 못했습니다. rooms.json 의 이름이 카톡 채팅방 이름과 정확히 같은지 확인하세요.")
    focus(hwnd)
    return hwnd


def send_file(room_name: str, path: Path):
    print(f"  → '{room_name}' 채팅방으로 전송 중: {path.name}")
    hwnd = open_chatroom(room_name)
    focus(hwnd)

    copy_file_to_clipboard(path)
    time.sleep(0.3)
    pyautogui.hotkey("ctrl", "v")
    time.sleep(1.2)
    pyautogui.press("enter")   # "파일 보내기" 확인 대화상자
    time.sleep(1.0)
    print(f"  ✅ 전송 완료: {path.name}")


def match_room(vendor: str, rooms: dict):
    if vendor in rooms:
        return rooms[vendor]
    # 부분 일치 허용 (예: 파일의 '푸드엔드베스트' vs 등록된 '푸드앤')
    for key, room in rooms.items():
        if key in vendor or vendor in key:
            return room
    return None


def process_file(path: Path, rooms: dict, sent: set) -> bool:
    m = FILENAME_RE.match(path.name)
    if not m:
        return False
    if path.name in sent:
        return False
    vendor = m.group(2)
    room = match_room(vendor, rooms)
    if not room:
        print(f"  ⚠ '{vendor}' 채팅방 매핑이 rooms.json 에 없어요 — 건너뜀: {path.name}")
        sent.add(path.name)  # 반복 경고 방지
        return False
    send_file(room, path)
    sent.add(path.name)
    save_sent(sent)
    return True


def watch_loop():
    rooms = load_rooms()
    sent = load_sent()
    print(f"👀 폴더 감시 시작: {WATCH_DIR}")
    print(f"   등록된 채팅방 매핑 {len(rooms)}개: {', '.join(rooms.keys())}")
    print("   (중단: Ctrl+C / 긴급중단: 마우스를 화면 왼쪽 위 모서리로)")
    while True:
        try:
            now = time.time()
            for p in sorted(WATCH_DIR.glob("*.xlsx")):
                if now - p.stat().st_mtime > FILE_MAX_AGE:
                    continue
                process_file(p, rooms, sent)
        except pyautogui.FailSafeException:
            print("🛑 긴급 중단됨 (failsafe)")
            return
        except KeyboardInterrupt:
            print("종료")
            return
        except Exception as e:
            print(f"  ⚠ 오류: {e}")
        time.sleep(POLL_SEC)


def main():
    if len(sys.argv) >= 3 and sys.argv[1] == "--once":
        rooms = load_rooms()
        path = Path(sys.argv[2])
        if not path.exists():
            print(f"파일이 없습니다: {path}")
            sys.exit(1)
        m = FILENAME_RE.match(path.name)
        vendor = m.group(2) if m else input("발주처 이름 입력: ").strip()
        room = match_room(vendor, rooms)
        if not room:
            print(f"'{vendor}' 채팅방 매핑이 rooms.json 에 없습니다.")
            sys.exit(1)
        send_file(room, path)
    else:
        watch_loop()


if __name__ == "__main__":
    main()
