@echo off
setlocal

echo.
echo ========================================
echo Starting workshop-ai
echo ========================================
echo.

where docker >nul 2>&1
if errorlevel 1 (
    echo Docker is not installed.
    pause
    exit /b 1
)

docker info >nul 2>&1
if errorlevel 1 (
    echo Docker Desktop is not running.
    pause
    exit /b 1
)

if exist state (
    echo State directory found.
)

echo.
echo Starting Docker services...
docker compose up -d

echo Waiting for services...
timeout /t 15 /nobreak >nul

if errorlevel 1 (
    echo Docker compose failed.
    pause
    exit /b 1
)

echo.
echo ==========================
echo READY
echo ==========================
echo.
echo Chat:
echo http://localhost:3001/chat
echo.
echo Agent:
echo http://localhost:3001/agent
echo.
echo UI:
echo http://localhost:3001
echo.
echo Process Builder:
echo http://localhost:3000
echo.
echo Backend:
echo http://localhost:8080
echo.
echo API Docs:
echo http://localhost:8080/docs
echo.

pause
