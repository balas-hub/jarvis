@echo off
title J.A.R.V.I.S.
cd /d "%~dp0"

echo ===================================================================
echo                       J. A. R. V. I. S.
echo          Browser Voice Assistant - Holographic Interface
echo ===================================================================
echo.

if not exist ".env.local" (
    echo [!] Notice: .env.local was not found. Creating from .env.example...
    copy .env.example .env.local >nul
)

echo Starting JARVIS Desktop System Application...
echo.

findstr /i "JARVIS_ENGINE=ollama" .env.local >nul 2>&1
if not errorlevel 1 (
    echo [Local Mode] Ollama engine detected.
    curl.exe -s http://127.0.0.1:11434/api/tags >nul 2>&1
    if errorlevel 1 (
        echo Starting Ollama background service...
        start "" /b ollama serve
        timeout /t 3 /nobreak >nul
    )
)

echo Launching standalone holographic window...
echo Click INITIALISE and say "Hey Jarvis".
echo Press Ctrl+C in this window to stop JARVIS.
echo.

set JARVIS_ALLOW_WRITES=1
call npm.cmd start -- --writes --app

if errorlevel 1 (
    echo.
    echo [!] JARVIS stopped with an error.
    pause
)
