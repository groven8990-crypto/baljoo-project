# 발주 알리미 — 샵마인 PC 설치 (install.bat 이 이 파일을 받아 실행)
# 파이썬 → 필요한 부품 → 알림 프로그램 → 바탕화면 아이콘 → 설정까지 한 번에 진행합니다.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Base = 'https://groven8990-crypto.github.io/baljoo-project/pc'
$Dir = Join-Path $env:USERPROFILE 'BaljooAlimi'

function Step($t) { Write-Host ''; Write-Host $t -ForegroundColor Cyan }
function Fail($t) { Write-Host ''; Write-Host "  [!] $t" -ForegroundColor Red; exit 1 }

# 진짜 파이썬 경로 찾기 (윈도우 스토어로 연결되는 가짜 python 은 실행 결과로 걸러짐)
function Find-Python {
  foreach ($c in @(@('python'), @('py', '-3'))) {
    try {
      $exe = & $c[0] @($c[1..9] | Where-Object { $_ }) -c 'import sys;print(sys.executable)' 2>$null
      if ($LASTEXITCODE -eq 0 -and $exe -and (Test-Path $exe)) { return $exe.Trim() }
    } catch {}
  }
  $found = Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Programs\Python') -Filter python.exe -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.Directory.Name -like 'Python3*' } | Sort-Object FullName -Descending | Select-Object -First 1
  if ($found) { return $found.FullName }
  return $null
}

Write-Host '===== 발주 알리미 PC 설치 =====' -ForegroundColor Yellow

Step '[1/4] 파이썬 확인 중...'
$py = Find-Python
if (-not $py) {
  Write-Host '  파이썬이 없어서 설치합니다. 1~3분 걸립니다. 창을 닫지 마세요.'
  $setup = Join-Path $env:TEMP 'python-3.12.7-amd64.exe'
  Invoke-WebRequest -UseBasicParsing 'https://www.python.org/ftp/python/3.12.7/python-3.12.7-amd64.exe' -OutFile $setup
  Start-Process $setup -ArgumentList '/quiet InstallAllUsers=0 PrependPath=1 Include_launcher=1' -Wait
  $py = Find-Python
}
if (-not $py) { Fail 'python.org 에서 파이썬을 설치할 때 "Add python.exe to PATH" 를 체크한 뒤 이 파일을 다시 실행해 주세요.' }
Write-Host "  사용: $py"

Step '[2/4] 필요한 부품 설치 중...'
& $py -m pip install --upgrade --quiet --disable-pip-version-check pyautogui pywin32
if ($LASTEXITCODE -ne 0) { Fail '부품 설치 실패 — 인터넷 연결을 확인하고 다시 실행해 주세요.' }

Step '[3/4] 알림 프로그램 받는 중...'
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
$script = Join-Path $Dir 'shopmine_alert.py'
# 주소 끝에 매번 다른 숫자를 붙여 예전에 받아 둔(캐시된) 파일이 아닌 최신 파일을 받음
Invoke-WebRequest -UseBasicParsing "$Base/shopmine_alert.py?v=$(Get-Random)" -Headers @{ 'Cache-Control' = 'no-cache' } -OutFile $script
# 바탕화면 아이콘: cmd /k 로 열어서 프로그램이 끝나도 창(안내 문구)이 남아 있게 함
$shell = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
foreach ($s in @(@('발주 알리미 실행', ''), @('발주 알리미 설정', ' --setup'))) {
  $lnk = $shell.CreateShortcut((Join-Path $desktop ($s[0] + '.lnk')))
  $lnk.TargetPath = Join-Path $env:SystemRoot 'System32\cmd.exe'
  $lnk.Arguments = "/k `"`"$py`" shopmine_alert.py$($s[1])`""
  $lnk.WorkingDirectory = $Dir
  $lnk.Save()
}
Write-Host '  바탕화면에 [발주 알리미 실행] [발주 알리미 설정] 아이콘을 만들었습니다.'

# 이미 설정해 둔 PC 는 프로그램만 새로 받고 설정은 건너뜀 (다시 하려면 [발주 알리미 설정])
if (Test-Path (Join-Path $Dir 'config.json')) {
  Step '[4/4] 기존 설정을 그대로 씁니다.'
} else {
  Step '[4/4] 설정을 시작합니다.'
  Push-Location $Dir
  & $py shopmine_alert.py --setup
  Pop-Location
}

Write-Host ''
Write-Host '설치 끝. 이제 바탕화면의 [발주 알리미 실행] 을 더블클릭하면 알림이 시작됩니다.' -ForegroundColor Green
