@echo off
title Dark Storage WMS - System Launcher
color 0B
cls
echo ======================================================================
echo                     DARK STORAGE WMS - LAUNCHER                      
echo ======================================================================
echo.

:: Ensure working directory is the project root
cd /d "%~dp0"

echo [1/3] Verifying environment...
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js was not found in your PATH!
    echo Please install Node.js from https://nodejs.org/ to run Dark Storage WMS.
    echo.
    pause
    exit /b 1
)

where npm >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] npm was not found in your PATH!
    echo.
    pause
    exit /b 1
)

echo [2/3] Scheduling browser auto-open (http://localhost:5173)...
start "" /b cmd /c "timeout /t 4 /nobreak >nul && start http://localhost:5173"

echo [3/3] Starting all 4 engines and web frontend...
echo.
echo   ------------------------------------------------------------------
echo   Web Frontend:          http://localhost:5173
echo   API Gateway:           http://localhost:4000
echo   Engine 1 (Scheduler):  http://127.0.0.1:4001
echo   Engine 2 (Optimizer):  http://127.0.0.1:4002
echo   Engine 3 (Inventory):  http://127.0.0.1:4003
echo   ------------------------------------------------------------------
echo.
echo   DEMO CREDENTIALS:
echo   Username:  manager1   (or operator1, picker1, staff1)
echo   Password:  Warehouse#2026
echo.
echo   [Tip] Press Ctrl+C in this window anytime to stop all engines.
echo ======================================================================
echo.

npm run dev
if %errorlevel% neq 0 (
    echo.
    echo [Notice] The application has stopped.
    pause
)
