@echo off
cd /d "%~dp0.."
if not exist logs mkdir logs
echo === gen images start === > logs\gen.log
call node scripts\make-test-images.js >> logs\gen.log 2>&1
echo === exit code %errorlevel% === >> logs\gen.log
echo Done. Check logs\gen.log
