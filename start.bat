@echo off
chcp 65001 >nul
title ABSeek
cd /d "%~dp0"

echo ====================================
echo   ABSeek starting...
echo   Project dir: %cd%
echo ====================================
echo.

REM Use node to call electron-vite directly, bypass sandbox restriction of npm run dev
node node_modules\electron-vite\bin\electron-vite.js dev

echo.
echo ====================================
echo   ABSeek exited
echo ====================================
pause
