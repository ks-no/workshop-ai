@echo off
setlocal EnableDelayedExpansion
REM ---------------------------------------------------------------------------
REM One-command start for the innbyggerdialog sandbox on Windows.
REM
REM Windows equivalent of start.sh, but deliberately simpler: Ollama runs in the
REM Docker Compose stack rather than natively, so there is no platform or GPU
REM detection to do. Everything comes up with a single "docker compose up".
REM
REM Like start.sh, this verifies that the model is actually reachable before
REM reporting success. That check matters: ai-gateway falls back to template
REM text when the model is unreachable, and the replies look perfectly fine.
REM ---------------------------------------------------------------------------

cd /d "%~dp0"

set "MODEL="
set "MOCK=false"
set "RESET=false"
set "DOWN=false"

:parse
if "%~1"=="" goto parsed
if /i "%~1"=="-h"      goto usage
if /i "%~1"=="--help"  goto usage
if /i "%~1"=="-d"      ( set "DOWN=true"  & shift & goto parse )
if /i "%~1"=="--down"  ( set "DOWN=true"  & shift & goto parse )
if /i "%~1"=="--mock"  ( set "MOCK=true"  & shift & goto parse )
if /i "%~1"=="--reset" ( set "RESET=true" & shift & goto parse )
if /i "%~1"=="-m"      ( set "MODEL=%~2"  & shift & shift & goto parse )
if /i "%~1"=="--model" ( set "MODEL=%~2"  & shift & shift & goto parse )
echo Unknown option: %~1
echo.
goto usage

:parsed

REM --- Preflight -------------------------------------------------------------

where docker >nul 2>&1
if errorlevel 1 (
  echo.
  echo [FEIL] Docker er ikke installert. Se https://docs.docker.com/get-docker/
  exit /b 1
)

docker info >nul 2>&1
if errorlevel 1 (
  echo.
  echo [FEIL] Docker er installert, men kjorer ikke. Start Docker Desktop og prov igjen.
  exit /b 1
)

if "%DOWN%"=="true" (
  echo.
  echo Stopper workshop-ai
  docker compose down -t 0
  echo.
  echo Stoppet.
  exit /b 0
)

if "%RESET%"=="true" (
  echo.
  echo Nullstiller kjoringstilstand i state\
  if exist state rmdir /s /q state
)

REM --- Configuration ---------------------------------------------------------

if not exist .env (
  if not exist .env.example (
    echo [FEIL] .env.example mangler fra repoet.
    exit /b 1
  )
  copy /y .env.example .env >nul
  REM Pa Windows kjorer Ollama i Compose, sa containernavnet er riktig rute --
  REM ikke host.docker.internal, som .env.example bruker for macOS.
  powershell -NoProfile -Command ^
    "(Get-Content .env) -replace '^OLLAMA_BASE_URL=.*','OLLAMA_BASE_URL=http://ollama:11434' | Set-Content .env"
  echo    Opprettet .env som peker pa http://ollama:11434
) else (
  echo    .env finnes -- lar den vaere i fred
)

if defined MODEL (
  powershell -NoProfile -Command ^
    "(Get-Content .env) -replace '^OLLAMA_MODEL=.*','OLLAMA_MODEL=%MODEL%' | Set-Content .env"
  echo    Bruker modell %MODEL%
)

if "%MOCK%"=="true" (
  powershell -NoProfile -Command ^
    "(Get-Content .env) -replace '^AI_PROVIDER=.*','AI_PROVIDER=mock' | Set-Content .env"
  echo    Kjorer med --mock: KI-svar blir maltekst, ingen modell.
)

for /f "tokens=2 delims==" %%A in ('findstr /b "OLLAMA_MODEL=" .env') do set "ACTIVE_MODEL=%%A"
if not defined ACTIVE_MODEL set "ACTIVE_MODEL=qwen2.5:7b"

REM --- Start -----------------------------------------------------------------

echo.
echo Starter tjenester
docker compose up -d
if errorlevel 1 (
  echo.
  echo [FEIL] docker compose up feilet. Se: docker compose logs
  exit /b 1
)

if "%MOCK%"=="false" (
  echo.
  echo Laster ned modellen %ACTIVE_MODEL% hvis den mangler ^(kan ta noen minutter^)
  docker compose exec -T ollama ollama pull %ACTIVE_MODEL%
  if errorlevel 1 echo    [ADVARSEL] Nedlasting av modell feilet. Sandboxen starter likevel.
)

REM "docker compose up -d" returnerer nar containerne er laget, ikke nar
REM HTTP-serverne tar imot kall. Vent til alle atte svarer.
echo.
echo Venter pa at tjenestene svarer
set "READY=false"
for /l %%i in (1,1,45) do (
  if "!READY!"=="false" (
    set "ALL_OK=true"
    for %%P in (8080 8081 8082 8083 8084 8085 3000 3001) do (
      curl -fsS -m 2 "http://localhost:%%P/health" >nul 2>&1 || set "ALL_OK=false"
    )
    if "!ALL_OK!"=="true" ( set "READY=true" ) else ( timeout /t 2 /nobreak >nul )
  )
)

if "!READY!"=="false" (
  echo.
  echo [FEIL] Tjenestene svarte ikke innen 90 sekunder. Se: docker compose logs
  exit /b 1
)
echo    alle atte tjenester svarer

REM --- Verify the model is really wired up -----------------------------------

set "LLM_OK=false"
if "%MOCK%"=="false" (
  echo.
  echo Verifiserer at modellen er koblet pa
  curl -fsS -m 180 -X POST http://localhost:8082/ai/klarsprak ^
    -H "Content-Type: application/json" ^
    -d "{\"kontekst\":{\"tjeneste\":\"oppstartssjekk\"},\"sprak\":\"nb\"}" > "%TEMP%\wai-verify.json" 2>nul

  if exist "%TEMP%\wai-verify.json" (
    findstr /c:"\"advarsel\"" "%TEMP%\wai-verify.json" >nul 2>&1
    if errorlevel 1 (
      findstr /c:"\"modell\": \"ollama:" "%TEMP%\wai-verify.json" >nul 2>&1
      if not errorlevel 1 set "LLM_OK=true"
    )
    del "%TEMP%\wai-verify.json" >nul 2>&1
  )
  if "!LLM_OK!"=="true" echo    bekreftet: ai-gateway bruker ollama:%ACTIVE_MODEL%
)

echo.
echo Klar
echo    Chat:            http://localhost:3001/chat
echo    Agent:           http://localhost:3001/agent
echo    Stegvis UI:      http://localhost:3001
echo    Prosessbygger:   http://localhost:3000
echo    Sandbox Backend: http://localhost:8080
echo    API-dokumentasjon: http://localhost:8080/docs

if "%MOCK%"=="true" (
  echo.
  echo    [ADVARSEL] Kjorer med --mock: KI-svar er maltekst, ikke en modell.
) else if "!LLM_OK!"=="false" (
  echo.
  echo    [ADVARSEL] Modellen er IKKE koblet pa. Svarene ser normale ut, men
  echo               kommer fra maler. Sjekk: docker compose logs ollama
)

echo.
echo    Stopp med: start.bat -d
echo.
exit /b 0

:usage
echo Bruk: start.bat [OPTIONS]
echo.
echo Starter sandboxen. Ollama kjorer i Docker Compose sammen med tjenestene.
echo.
echo Options:
echo   -m, --model MODEL  Bruk en bestemt Ollama-modell
echo       --mock         Kjor uten sprakmodell ^(KI-svar blir maltekst^)
echo       --reset        Nullstill kjoringstilstand i state\
echo   -d, --down         Stopp og fjern alle containere
echo   -h, --help         Vis denne hjelpen
echo.
echo Eksempler:
echo   start.bat                  # bare start
echo   start.bat -m qwen2.5:7b    # mindre modell
echo   start.bat --mock           # ingen modell
echo   start.bat --reset          # glem tidligere demokjoringer
echo   start.bat -d               # stopp alt
exit /b 0
