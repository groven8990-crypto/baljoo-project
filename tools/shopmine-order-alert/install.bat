@echo off
rem Baljoo Alimi PC setup - downloads install.ps1 and runs it (this file stays ASCII on purpose)
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol='Tls12'; $f=Join-Path $env:TEMP 'baljoo-install.ps1'; Invoke-WebRequest -UseBasicParsing 'https://groven8990-crypto.github.io/baljoo-project/pc/install.ps1' -OutFile $f; & $f"
pause
