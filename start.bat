@echo off
setlocal

set RELOAD=0
set DOWN=0

:parse_args
if "%~1"=="--reload" (set RELOAD=1 & shift & goto parse_args)
if "%~1"=="-d"       (set DOWN=1   & shift & goto parse_args)
if "%~1"=="--down"   (set DOWN=1   & shift & goto parse_args)
if not "%~1"=="" (
    echo Unknown option: %~1
    echo Usage: start.bat [--reload] [-d^|--down]
    pause
    exit /b 1
)

echo.
echo ========================================
echo workshop-ai
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
    echo Docker Desktop is not running. Start it and try again.
    pause
    exit /b 1
)

if %DOWN%==1 (
    echo Stopping workshop-ai...
    docker compose down -t 0
    echo.
    echo Stopped.
    exit /b 0
)

if %RELOAD%==1 (
    echo Reloading Node services...
    docker compose up -d sandbox-backend fiks-simulator ai-gateway mcp-services process-agent matrikkel-mock demo-gui process-builder
    echo.
    echo Done. Code changes are live.
    exit /b 0
)

echo Starting Docker services...
echo (Using polling watcher — works on Windows host filesystem)
echo.

rem WATCH_POLL=1 switches scripts/dev.sh to nodemon --legacy-watch so that
rem file changes on the Windows host filesystem are picked up inside the
rem container. Plain "node --watch" relies on inotify which does not propagate
rem through Docker Desktop's 9P volume mount from the Windows filesystem.
set WATCH_POLL=1

docker compose up -d
if errorlevel 1 (
    echo docker compose failed.
    pause
    exit /b 1
)

echo.
echo Waiting for services to start...
timeout /t 20 /nobreak >nul

echo.
echo ==========================
echo READY
echo ==========================
echo.
echo Chat:            http://localhost:3001/chat
echo Agent:           http://localhost:3001/agent
echo Step-by-step UI: http://localhost:3001/stegvis
echo Dashboard:       http://localhost:3001
echo Process Builder: http://localhost:3000
echo AI trace:        http://localhost:8082/trace
echo API docs:        http://localhost:8080/docs
echo.
echo File changes are picked up automatically (polling every ~1s).
echo To stop: start.bat --down
echo.
pause
