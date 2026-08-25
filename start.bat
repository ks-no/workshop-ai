@echo off
setlocal

set RELOAD=0
set DOWN=0

rem The nine Node services. Naming them explicitly keeps the ~4 GB ollama image
rem out of the pull: it has no compose profile, so a bare "up -d" would start it
rem even though this script never downloads a model for it to serve.
set SERVICES=sandbox-backend fiks-simulator ai-gateway tools-api process-agent matrikkel-mock digdir-mock demo-gui process-builder

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

rem This script never pulls a language model, so anything other than mock would
rem leave the gateway reaching for a model that is not there - every AI reply
rem would be template text with nothing saying so. Being explicit makes the
rem stack honest about what it is. For a real model, use Git Bash or WSL and
rem run ./start.sh, which detects your hardware and downloads a matching model.
set AI_PROVIDER=mock

if %RELOAD%==1 (
    echo Reloading Node services...
    docker compose up -d --no-deps %SERVICES%
    echo.
    echo Done. Code changes are live.
    exit /b 0
)

echo Starting Docker services...
echo.

rem WATCH_POLL=1 switches scripts/dev.sh to nodemon --legacy-watch so that
rem file changes on the Windows host filesystem are picked up inside the
rem container. Plain "node --watch" relies on inotify which does not propagate
rem through Docker Desktop's 9P volume mount from the Windows filesystem.
rem nodemon is a devDependency: without "pnpm install" it is missing, and
rem dev.sh falls back to node --watch with a note on stderr. The stack still
rem runs; live reload is what you lose. That is why the line below is
rem conditional rather than a flat promise.
set WATCH_POLL=1

docker compose up -d --no-deps %SERVICES%
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
echo   Read first:
echo   What to build:   docs/oppdraget.md
echo   Getting started: docs/deltakerstart.md
echo   Build your own:  docs/bygg-selv.md
echo.
echo   Overview and APIs:
echo   Dashboard:       http://localhost:3001
echo   API explorer:    http://localhost:3001/utforsker
echo   API docs:        http://localhost:8080/docs
echo.
echo   Reference clients - examples, not the answer:
echo   Step-by-step UI: http://localhost:3001/stegvis
echo   Chat:            http://localhost:3001/chat
echo   Agent:           http://localhost:3001/agent
echo   Process Builder: http://localhost:3000
echo.
echo   When the AI looks wrong:
echo   AI trace:        http://localhost:8082/trace
echo.
echo   Running without a language model: AI replies are template text.
echo   For a real model, use Git Bash or WSL and run ./start.sh
echo.
echo   If you ran "pnpm install", code changes reload automatically.
echo   Without it the stack still runs, but you restart with: start.bat --reload
echo.
echo   To stop: start.bat --down
echo.
pause
