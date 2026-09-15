@echo off
title J.A.R.V.I.S. - 100%% Local Offline Mode (Ollama)
cd /d "%~dp0"

echo ===================================================================
echo                       J. A. R. V. I. S.
echo            100%% LOCAL & OFFLINE MODE (POWERED BY OLLAMA)
echo ===================================================================
echo.

set JARVIS_ENGINE=ollama
if "%OLLAMA_MODEL%"=="" set OLLAMA_MODEL=qwen2.5:7b
set JARVIS_ALLOW_WRITES=1

echo Checking local Ollama service...
curl.exe -s http://127.0.0.1:11434/api/tags >nul 2>&1
if errorlevel 1 (
    echo Starting Ollama background service...
    start "" /b ollama serve
    timeout /t 3 /nobreak >nul
)

echo Intelligence Engine : Local Ollama (%OLLAMA_MODEL%)
echo Endpoint            : http://127.0.0.1:11434
echo Privacy             : 100%% Private - Zero Cloud APIs - Offline
echo Full PC Control     : ENABLED (PowerShell, Apps, Windows System)
echo.
echo Launching standalone holographic window...
echo Click INITIALISE and say "Hey Jarvis".
echo Press Ctrl+C in this window to stop JARVIS.
echo.

call npm.cmd start -- --writes --app

if errorlevel 1 (
    echo.
    echo [!] JARVIS stopped with an error.
    pause
)
