@echo off
rem Starts Twisted Cafe on this Windows PC (port 8080). Logs go to data\logs\server.log
cd /d "%~dp0"
set NODE_ENV=production
set PORT=8080
node server/index.js >> data\logs\server.log 2>&1
