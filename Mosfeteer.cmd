@echo off
rem Windows: double-click to start Mosfeteer. Needs Node.js 18+.
cd /d "%~dp0"
where node >nul 2>nul || (echo Mosfeteer needs Node.js 18 or newer: https://nodejs.org/ & pause & exit /b 1)
node launch.mjs %*
