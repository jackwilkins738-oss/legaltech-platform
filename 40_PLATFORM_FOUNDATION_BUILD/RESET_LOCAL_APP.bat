@echo off
setlocal
cd /d "%~dp0"
if exist .dev-data rmdir /s /q .dev-data
echo Synthetic local data reset.
pause
