@echo off
cd /d "%~dp0.."
if not exist logs mkdir logs
echo === npm install start %date% %time% === > logs\install.log
call npm install --no-audit --no-fund >> logs\install.log 2>&1
echo === exit code %errorlevel% === >> logs\install.log
echo Done. Check logs\install.log
