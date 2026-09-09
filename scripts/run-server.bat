@echo off
cd /d "%~dp0.."
if not exist logs mkdir logs
echo === server start %date% %time% === > logs\server.log
node server.js >> logs\server.log 2>&1
