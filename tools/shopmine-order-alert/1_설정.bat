@echo off
chcp 65001 >nul
cd /d "%~dp0"
python shopmine_alert.py --setup
pause
