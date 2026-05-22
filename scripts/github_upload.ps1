# =============================================================================
# Baljoo HTML 업로드 스크립트 (회사 저장소: groven8990-crypto/baljoo-project)
# =============================================================================
# - 같은 폴더에 있는 index.html을 GitHub 회사 저장소의 src/index.html 에 업로드
# - 푸시 후, 데스크톱 앱에서 Ctrl+R 한 번이면 최신 HTML 반영됨
# =============================================================================

$TOKEN  = "PASTE_NEW_TOKEN_HERE"
$REPO   = "groven8990-crypto/baljoo-project"
$BRANCH = "main"
$FILE   = "$PSScriptRoot\index.html"
$REMOTE_PATH = "src/index.html"
$API_URL = "https://api.github.com/repos/$REPO/contents/$REMOTE_PATH"

Write-Host "==================================" -ForegroundColor Cyan
Write-Host " Baljoo GitHub Upload (회사 저장소)" -ForegroundColor Cyan
Write-Host "==================================" -ForegroundColor Cyan
Write-Host " Repo   : $REPO" -ForegroundColor Gray
Write-Host " Branch : $BRANCH" -ForegroundColor Gray
Write-Host " Path   : $REMOTE_PATH" -ForegroundColor Gray
Write-Host ""

if ($TOKEN -eq "PASTE_NEW_TOKEN_HERE" -or [string]::IsNullOrWhiteSpace($TOKEN)) {
    Write-Host "[ERROR] 토큰이 설정되지 않았습니다." -ForegroundColor Red
    Write-Host "이 파일을 메모장으로 열어 `$TOKEN = `"...`" 줄에 새 토큰을 붙여넣으세요." -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
}

if (-not (Test-Path $FILE)) {
    Write-Host "[ERROR] index.html 파일을 찾을 수 없습니다: $FILE" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

$bytes   = [System.IO.File]::ReadAllBytes($FILE)
$content = [Convert]::ToBase64String($bytes)

$headers = @{
    "Authorization" = "token $TOKEN"
    "User-Agent"    = "baljoo-deploy"
    "Accept"        = "application/vnd.github.v3+json"
}

Write-Host "기존 파일 확인 중..." -ForegroundColor Yellow

$sha = $null
try {
    $existing = Invoke-RestMethod -Uri "$API_URL`?ref=$BRANCH" -Headers $headers -Method GET -ErrorAction SilentlyContinue
    $sha = $existing.sha
    Write-Host "업데이트 모드 (기존 파일 존재)" -ForegroundColor Green
} catch {
    Write-Host "최초 업로드" -ForegroundColor Green
}

$body = @{
    message = "Update index.html - $(Get-Date -Format yyyyMMdd-HHmm)"
    content = $content
    branch  = $BRANCH
}
if ($sha) { $body.sha = $sha }
$json = $body | ConvertTo-Json

Write-Host "GitHub에 업로드 중..." -ForegroundColor Yellow

try {
    $result = Invoke-RestMethod -Uri $API_URL -Headers $headers -Method PUT -Body $json -ContentType "application/json"
    Write-Host ""
    Write-Host "[SUCCESS] 업로드 완료!" -ForegroundColor Green
    Write-Host ""
    Write-Host "다음 단계:" -ForegroundColor Cyan
    Write-Host "  1) 발주 자동화 앱을 켜고 Ctrl+R (또는 메뉴 > 보기 > 새로 고침)" -ForegroundColor White
    Write-Host "  2) 수정 내용이 즉시 반영됩니다" -ForegroundColor White
    Write-Host ""
    Write-Host "저장소: https://github.com/$REPO/blob/$BRANCH/$REMOTE_PATH" -ForegroundColor Gray
} catch {
    Write-Host "[ERROR] $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $errorBody = $reader.ReadToEnd()
        Write-Host "응답: $errorBody" -ForegroundColor Red
    }
}

Write-Host ""
Read-Host "Press Enter to exit"
