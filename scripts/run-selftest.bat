@echo off
cd /d "%~dp0.."
if not exist logs mkdir logs
echo === selftest start === > logs\selftest.log
call node scripts\selftest.js >> logs\selftest.log 2>&1
echo === exit code %errorlevel% === >> logs\selftest.log
echo Done. Check logs\selftest.log
