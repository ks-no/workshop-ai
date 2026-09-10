@echo off
setlocal
cd /d "%~dp0"
if errorlevel 1 exit /b 1

rem One-command start for workshop-ai on Windows, without Git Bash or WSL.
rem
rem Deliberately smaller than start.sh: it never installs Ollama, never selects a
rem model from the hardware and never downloads one, so the stack always answers
rem with template text. Everything else - the port check, .env, --reset, and
rem waiting until the services actually answer - mirrors start.sh.
rem
rem The file is plain ASCII on purpose, and it has no chcp. cmd.exe reads a batch
rem file in the console code page rather than UTF-8, so Norwegian letters in an
rem echo line come out as mojibake on a Norwegian Windows box - and a UTF-8 BOM
rem makes "@echo off" itself fail. The prose it prints is therefore Norwegian
rem written without ae/oe/aa. Do not "fix" the spelling here.

set RELOAD=0
set DOWN=0
set RESET=0
set RECREATE=

rem The eleven Node services. Naming them explicitly keeps the ~4 GB ollama image
rem out of the pull: it has no compose profile, so a bare "up -d" would start it
rem even though this script never downloads a model for it to serve.
set SERVICES=sandbox-backend fiks-simulator ai-gateway tools-api process-agent matrikkel-mock digdir-mock pasientjournal-mock politiattest-mock demo-gui process-builder innbyggerportal
set SERVICE_PORTS=3000 3001 3002 8080 8081 8082 8083 8084 8085 8086 8087 8088

:parse_args
if "%~1"=="--reload" (set "RELOAD=1" & shift & goto parse_args)
if "%~1"=="--reset"  (set "RESET=1"  & shift & goto parse_args)
if "%~1"=="-d"       (set "DOWN=1"   & shift & goto parse_args)
if "%~1"=="--down"   (set "DOWN=1"   & shift & goto parse_args)
rem --mock is accepted and does nothing. This file has no other mode, and a
rem participant copying a command out of the README should not hit an error.
if "%~1"=="--mock"   (shift & goto parse_args)
if "%~1"=="-h"       goto show_usage
if "%~1"=="--help"   goto show_usage
if "%~1"=="-m"       goto model_flag
if "%~1"=="--model"  goto model_flag
if not "%~1"=="" goto unknown_option

if %RESET%==1 if %RELOAD%==1 goto conflicting_flags
if %DOWN%==1 if %RESET%==1 goto conflicting_flags
if %DOWN%==1 if %RELOAD%==1 goto conflicting_flags

echo.
echo ========================================
echo workshop-ai
echo ========================================
echo.

where docker >nul 2>&1
if errorlevel 1 goto no_docker

docker info >nul 2>&1
if errorlevel 1 goto docker_not_running

if %DOWN%==1 goto do_down

rem Without curl we cannot verify startup, so do not claim that it succeeded.
where curl >nul 2>&1
if errorlevel 1 goto no_curl
docker compose version >nul
if errorlevel 1 goto compose_failed
docker compose config --quiet
if errorlevel 1 goto compose_failed

rem This script never pulls a language model, so anything other than mock would
rem leave the gateway reaching for a model that is not there - every AI reply
rem would be template text with nothing saying so. Being explicit makes the
rem stack honest about what it is. For a real model, use Git Bash or WSL and
rem run ./start.sh, which detects your hardware and downloads a matching model.
set AI_PROVIDER=mock

rem WATCH_POLL=1 switches scripts/dev.sh to nodemon --legacy-watch so that
rem file changes on the Windows host filesystem are picked up inside the
rem container. Plain "node --watch" relies on inotify which does not propagate
rem through Docker Desktop's 9P volume mount from the Windows filesystem.
rem nodemon is a devDependency: without "pnpm install" it is missing, and
rem dev.sh falls back to node --watch with a note on stderr. The stack still
rem runs; live reload is what you lose. That is why the line below is
rem conditional rather than a flat promise.
set WATCH_POLL=1

rem Both variables are set above the --reload branch, not only on the start path.
rem "up -d" recreates each container from the current environment, so setting
rem them later would let a reload silently swap working template text for
rem AI_PROVIDER=ollama out of .env and turn polling back off - and the first code
rem change a participant makes would turn into "the model is not connected".
echo Sjekker forutsetninger ...
call :check_ports
if not "%CONFLICTS%"=="" goto port_conflict

call :ensure_env
if errorlevel 1 goto env_failed

if %RELOAD%==1 goto do_reload

if %RESET%==1 call :reset_state
if errorlevel 1 goto reset_failed

echo.
echo Starter tjenestene ...
docker compose up -d %RECREATE% --no-deps %SERVICES%
if errorlevel 1 goto compose_failed

echo.
echo Venter til tjenestene svarer ...
call :wait_for_services
if "%WAIT_OK%"=="0" goto not_healthy
call :verify_mock
if errorlevel 1 goto mock_failed

echo.
echo ==========================
echo KLAR
echo ==========================
echo.
echo   Start her:
echo   Hva du skal bygge:    docs/oppdraget.md
echo   Kom i gang:           docs/deltakerstart.md
echo   Bygg ditt eget:       docs/bygg-selv.md
echo.
echo   Oversikt og API-er:
echo   Dashbord:             http://localhost:3001
echo   API-utforsker:        http://localhost:3001/utforsker
echo   API-dokumentasjon:    http://localhost:8080/docs
echo.
echo   Referanseklienter - eksempler, ikke fasiten:
echo   Stegvis grensesnitt:  http://localhost:3001/stegvis
echo   Chat:                 http://localhost:3001/chat
echo   Agent:                http://localhost:3001/agent
echo   Prosessbygger:        http://localhost:3000
echo   Min side:             http://localhost:3002
echo.
echo   Hvis KI-en ser feil ut:
echo   KI-spor:              http://localhost:8082/trace
echo   KI-leverandor:        http://localhost:8082/admin
echo.
echo   Ingen modell er koblet til: KI-svarene er ferdigskrevet maltekst.
echo   Vil du ha en ekte modell, bruk Git Bash eller WSL og start ./start.sh
echo.
echo   Har du gjort "pnpm install", lastes kodeendringer inn automatisk.
echo   Uten den starter alt likevel, men da laster du om selv: start.bat --reload
echo.
echo   Stopp med: start.bat --down
echo.
pause
exit /b 0

rem --- Branches that end the script -------------------------------------------

:do_down
echo Stopper workshop-ai ...
docker compose down -t 0
if errorlevel 1 goto compose_failed
echo.
echo Stoppet.
exit /b 0

:do_reload
echo Starter Node-tjenestene om igjen ...
rem Force a fresh process even when the container configuration is unchanged.
docker compose up -d --force-recreate --no-deps %SERVICES%
if errorlevel 1 goto compose_failed
call :wait_for_services
if "%WAIT_OK%"=="0" goto not_healthy
call :verify_mock
if errorlevel 1 goto mock_failed
echo.
echo Klar - kodeendringene er i drift.
exit /b 0

:show_usage
call :usage
exit /b 0

:model_flag
echo Modellvalg styres ikke herfra: start.bat starter alltid uten modell.
echo Bruk Git Bash eller WSL: ./start.sh -m MODELL
pause
exit /b 1

:unknown_option
echo Ukjent valg: %~1
echo.
call :usage
pause
exit /b 1

:no_docker
echo Docker er ikke installert.
echo Hent Docker Desktop fra https://docs.docker.com/get-docker/
pause
exit /b 1

:docker_not_running
echo Docker Desktop er ikke startet. Start Docker Desktop, og start dette
echo skriptet en gang til.
pause
exit /b 1

:port_conflict
echo.
echo   Portene er allerede i bruk av noe annet:%CONFLICTS%
echo   Stopp det som lytter der, og start dette skriptet en gang til.
pause
exit /b 1

:env_failed
echo.
echo   Kunne ikke opprette .env. Kontroller .env.example og skrivetilgang.
pause
exit /b 1

:conflicting_flags
echo --reset, --reload og --down kan ikke kombineres.
exit /b 1

:no_curl
echo curl mangler. Installer curl for aa kunne sjekke oppstarten.
exit /b 1

:reset_failed
echo Nullstillingen feilet. Tjenestene blir ikke startet automatisk.
echo Ved stopp- eller kopieringsfeil er state/ ikke slettet.
echo Rett feilen og start skriptet igjen.
exit /b 1

:mock_failed
echo --mock ble overstyrt av et lagret admin-valg, eller KI-statusen kunne ikke leses.
echo Velg mock paa http://localhost:8082/admin og start igjen.
echo Vil du nullstille hele kjoringen, bruk start.bat --reset.
exit /b 1

:compose_failed
echo.
echo   docker compose feilet.
pause
exit /b 1

:not_healthy
echo.
echo   Tjenestene svarte ikke innen 90 sekunder.
echo   Se hva som skjedde: docker compose logs
pause
exit /b 1

rem --- Subroutines -------------------------------------------------------------

:usage
echo Bruk: start.bat [VALG]
echo.
echo Starter sandkassen i Docker, uten Git Bash eller WSL. Denne filen starter
echo alltid uten modell, og da er KI-svarene maltekst.
echo.
echo Valg:
echo   --reset     Stopp Node-tjenestene, kopier og slett state/, gjenskap dem
echo   --reload    Gjenskap Node-containerne med dagens konfigurasjon
echo   --mock      Uten effekt: denne filen starter alltid uten modell
echo   -d, --down  Stopp og fjern alle containere
echo   -h, --help  Vis denne hjelpen
echo.
echo Vil du ha en ekte modell, bruk Git Bash eller WSL og start ./start.sh
echo Det skriptet finner maskinvaren din og laster ned en modell som passer.
goto :eof

:ensure_env
if exist .env (
    echo   .env finnes allerede og blir ikke endret.
    exit /b 0
)
if not exist .env.example exit /b 1
rem Unlike start.sh this copies .env.example verbatim. The two lines that script
rem rewrites both point at Ollama, and there is no Ollama here to point at.
copy .env.example .env >nul
if errorlevel 1 exit /b 1
echo   opprettet .env fra .env.example
exit /b 0

:reset_state
rem Quiesce every writer before reading the backup, then discard cached state.
docker compose stop %SERVICES%
if errorlevel 1 exit /b 1
if exist state (
  call :backup_state
  if errorlevel 1 exit /b 1
  rmdir /s /q state
  if errorlevel 1 exit /b 1
  if exist state exit /b 1
)
set RECREATE=--force-recreate
echo   state/ er slettet - tjenestene starter fra seed-dataene.
exit /b 0

rem Mirrors backup_state in start.sh; keep the two in step.
rem PowerShell supplies a locale-independent clock, unique names and terminating
rem copy errors. Include hidden files and directories, never the signing key.
:backup_state
powershell -NoProfile -Command "$ErrorActionPreference = 'Stop'; if ((Get-Item -LiteralPath state -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'state/ er en lenke. Avbryter uten aa slette.' }; $files = @(Get-ChildItem -LiteralPath state -Force | Where-Object { $_.Name -ine 'digdir-nokkel.json' }); if ($files.Count -eq 0) { exit 0 }; $target = Join-Path '_backup' ((Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N') + '-utc'); New-Item -ItemType Directory -Path $target | Out-Null; foreach ($file in $files) { Copy-Item -LiteralPath $file.FullName -Destination $target -Recurse -Force }; Write-Output ('tok vare paa state/ i ' + $target)"
if errorlevel 1 exit /b 1
exit /b 0

:verify_mock
curl -fsS -m 5 http://localhost:8082/helse | findstr /r /c:"\"provider\": *\"mock\"" >nul
if errorlevel 1 exit /b 1
exit /b 0

:check_ports
set CONFLICTS=
for %%P in (%SERVICE_PORTS%) do call :check_port %%P
goto :eof

:check_port
netstat -ano -p tcp | findstr /r /c:":%1 .*LISTENING" >nul 2>&1
if errorlevel 1 goto :eof
call :port_is_ours %1
if "%IS_OURS%"=="1" goto :eof
set CONFLICTS=%CONFLICTS% %1
goto :eof

:port_is_ours
set IS_OURS=0
curl -fsS -m 2 http://localhost:%1/helse 2>nul | findstr "tjeneste" >nul 2>&1
if errorlevel 1 goto :eof
set IS_OURS=1
goto :eof

rem "docker compose up -d" returns once the containers are created, not once the
rem HTTP servers accept connections, so poll /helse rather than guess at a wait.
:wait_for_services
set WAIT_OK=0
set WAITED=0
:wait_loop
call :all_healthy
if "%HEALTHY%"=="1" (
    set WAIT_OK=1
    goto :eof
)
if %WAITED% GEQ 90 goto :eof
timeout /t 3 /nobreak >nul 2>&1
set /a WAITED=%WAITED% + 3
goto wait_loop

:all_healthy
set HEALTHY=1
for %%P in (%SERVICE_PORTS%) do call :probe_port %%P
goto :eof

:probe_port
curl -fsS -m 2 http://localhost:%1/helse 2>nul | findstr "tjeneste" >nul 2>&1
if errorlevel 1 set HEALTHY=0
goto :eof
