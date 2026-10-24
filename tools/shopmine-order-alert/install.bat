@echo off
chcp 65001 >nul
setlocal
title 발주 알리미 PC 설치
rem 샵마인 PC 에서 한 번만 실행: 파이썬 → 필요한 부품 → 알림 프로그램 → 바탕화면 아이콘 → 설정까지 자동으로 진행
set "DIR=%USERPROFILE%\발주알리미"
set "BASE=https://groven8990-crypto.github.io/baljoo-project/pc"

echo.
echo  ===== 발주 알리미 PC 설치 =====
echo.
echo [1/4] 파이썬 확인 중...
call :findpy
if not defined PY (
  echo       파이썬이 없어서 설치합니다. 1~3분 걸립니다. 창을 닫지 마세요.
  winget install -e --id Python.Python.3.12 --scope user --accept-package-agreements --accept-source-agreements --override "/quiet InstallAllUsers=0 PrependPath=1 Include_launcher=1"
  call :findpy
)
if not defined PY (
  echo.
  echo  [!] 파이썬을 자동으로 설치하지 못했습니다.
  echo      python.org 에서 설치할 때 "Add python.exe to PATH" 를 체크한 뒤, 이 파일을 다시 실행해 주세요.
  pause
  exit /b 1
)
echo       사용: %PY%

echo [2/4] 필요한 부품 설치 중...
"%PY%" -m pip install --upgrade --quiet --disable-pip-version-check pyautogui pywin32
if errorlevel 1 ( echo  [!] 부품 설치 실패 — 인터넷 연결을 확인하고 다시 실행해 주세요. & pause & exit /b 1 )

echo [3/4] 알림 프로그램 받는 중...
if not exist "%DIR%" mkdir "%DIR%"
rem 한글 경로는 명령줄 대신 환경변수로 PowerShell 에 넘김 (명령줄로 넘기면 글자가 깨질 수 있음)
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing ($env:BASE + '/shopmine_alert.py') -OutFile (Join-Path $env:DIR 'shopmine_alert.py')"
if not exist "%DIR%\shopmine_alert.py" ( echo  [!] 프로그램을 받지 못했습니다. & pause & exit /b 1 )
> "%DIR%\설정.bat" echo @echo off
>>"%DIR%\설정.bat" echo chcp 65001 ^>nul
>>"%DIR%\설정.bat" echo cd /d "%DIR%"
>>"%DIR%\설정.bat" echo "%PY%" shopmine_alert.py --setup
>>"%DIR%\설정.bat" echo pause
> "%DIR%\실행.bat" echo @echo off
>>"%DIR%\실행.bat" echo chcp 65001 ^>nul
>>"%DIR%\실행.bat" echo title 발주 알리미 - 이 창을 닫지 마세요
>>"%DIR%\실행.bat" echo cd /d "%DIR%"
>>"%DIR%\실행.bat" echo "%PY%" shopmine_alert.py
>>"%DIR%\실행.bat" echo pause
set "N1=발주 알리미 실행"
set "N2=발주 알리미 설정"
set "B1=%DIR%\실행.bat"
set "B2=%DIR%\설정.bat"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=New-Object -ComObject WScript.Shell; $d=[Environment]::GetFolderPath('Desktop'); foreach($p in @(@($env:N1,$env:B1),@($env:N2,$env:B2))){ $l=$s.CreateShortcut((Join-Path $d ($p[0]+'.lnk'))); $l.TargetPath=$p[1]; $l.WorkingDirectory=$env:DIR; $l.Save() }"
echo       바탕화면에 [발주 알리미 실행] [발주 알리미 설정] 아이콘을 만들었습니다.

echo [4/4] 설정을 시작합니다.
echo.
"%PY%" "%DIR%\shopmine_alert.py" --setup
echo.
echo  설치 끝. 이제 바탕화면의 [발주 알리미 실행] 을 더블클릭하면 알림이 시작됩니다.
pause
exit /b 0

:findpy
set "PY="
for /f "delims=" %%i in ('python -c "import sys;print(sys.executable)" 2^>nul') do set "PY=%%i"
if defined PY goto :eof
for /f "delims=" %%i in ('py -3 -c "import sys;print(sys.executable)" 2^>nul') do set "PY=%%i"
if defined PY goto :eof
for /d %%d in ("%LOCALAPPDATA%\Programs\Python\Python3*") do if exist "%%d\python.exe" set "PY=%%d\python.exe"
goto :eof
