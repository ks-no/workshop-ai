#!/usr/bin/env bash
#
# One-command start for the innbyggerdialog sandbox.
#
# Starts the services and, unless the active AI provider is mock, verifies that
# the model actually answers before reporting success. Mock is the default.
#
# --ollama opts in to a local model, and Ollama then runs on the host, never in a
# container: the ollama/ollama image carries many known CVEs, every image in
# docker-compose.yml is scanned and reported by sbom-images.yml, and a host install
# is updated by Ollama itself rather than pinned by us. On macOS it also gets
# Metal, which Docker Desktop cannot reach.
#
# The verification matters: ai-gateway falls back to template text when the
# model is unreachable, and the responses look perfectly fine. Without an
# explicit check you cannot tell a working setup from a broken one.

set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Services that run in Docker on every platform.
# matrikkel-mock must stay in this list: we start only these by name, with --no-deps,
# and tools-api proxies its three matrikkel_* tools to it over MATRIKKEL_BASE_URL.
# Leave it out and those tools fail with "fetch failed" while everything else looks fine.
# digdir-mock must stay in this list for the same reason as matrikkel-mock: we
# start only these by name, and everything that needs a token dials it.
# Leave it out and every authenticated call fails while the stack looks healthy.
NODE_SERVICES=(sandbox-backend fiks-simulator ai-gateway tools-api process-agent matrikkel-mock digdir-mock pasientjournal-mock politiattest-mock demo-gui process-builder)
SERVICE_PORTS=(8080 8081 8082 8083 8084 8085 8086 8087 8088 3000 3001)

MODEL=""
ASSUME_YES=false
DOWN=false
MOCK=false
OLLAMA=false
RESET=false
RELOAD=false

step() { printf '\n%s\n' "$*"; }
info() { printf '   %s\n' "$*"; }
warn() { printf '   ⚠️  %s\n' "$*"; }
fail() { printf '\n❌ %s\n\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Bruk: ./start.sh [VALG]

Starter sandkassen. Uten noe annet valgt er KI-leverandøren mock, og da er
KI-svarene maltekst. Leverandøren velges i .env (AI_PROVIDER) eller på
http://localhost:8082/admin, og er den noe annet enn mock, sjekker skriptet at
modellen svarer.

Valg:
      --ollama       Bruk en lokal modell i Ollama på denne maskinen, og husk valget i .env
  -m, --model MODELL Bruk en bestemt Ollama-modell i stedet for den automatiske (med --ollama)
  -y, --yes          Ikke spør før Ollama installeres eller en modell lastes ned
      --mock         Bruk mock denne gangen, uansett hva .env sier
      --reset        Stopp Node-tjenestene, sikkerhetskopier og tøm state/, og gjenskap dem
      --reload       Gjenskap Node-containerne med dagens konfigurasjon, og avslutt
  -d, --down         Stopp og fjern alle containere
  -h, --help         Vis denne hjelpen

Ollama kjører på maskinen, ikke i Docker. På macOS installerer skriptet den med
brew hvis den mangler. Andre steder må den være installert fra
https://ollama.com/download. Modellen velges ut fra RAM/VRAM:
  qwen2.5:0.5b       under 12 GB RAM (rundt 400 MB)
  qwen2.5:7b         12 GB RAM eller mer (rundt 4,7 GB)
  qwen2.5:14b        32 GB RAM eller mer (rundt 9 GB)

Eksempler:
  ./start.sh                  # bare start
  ./start.sh --ollama         # med lokal modell
  ./start.sh --ollama -m qwen2.5:7b
  ./start.sh --reset          # glem alle tidligere demokjøringer
  ./start.sh --reload         # start tjenestene på nytt etter en kodeendring
  ./start.sh -d               # stopp alt
EOF
}

# --- 1. Arguments -----------------------------------------------------------

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mock)     MOCK=true; shift ;;
    --ollama)   OLLAMA=true; shift ;;
    -m|--model) MODEL="${2:-}"; [[ -n "$MODEL" && "$MODEL" != -* ]] || fail "--model trenger en verdi"; shift 2 ;;
    -y|--yes)   ASSUME_YES=true; shift ;;
    --reset)    RESET=true; shift ;;
    --reload)   RELOAD=true; shift ;;
    -d|--down)  DOWN=true; shift ;;
    -h|--help)  usage; exit 0 ;;
    -g|--gpu|-p|--pull)
      # Kept so older commands do not break.
      warn "$1 trengs ikke lenger - Ollama kjører på maskinen og tar GPU-en selv"
      shift ;;
    *) printf 'Ukjent valg: %s\n\n' "$1" >&2; usage; exit 1 ;;
  esac
done

if { $RESET && $RELOAD; } || { $DOWN && { $RESET || $RELOAD; }; }; then
  fail "--reset, --reload og --down kan ikke kombineres."
fi
if $OLLAMA && { $MOCK || $RELOAD || $DOWN; }; then
  fail "--ollama kan ikke kombineres med --mock, --reload eller --down.
   Valget huskes i .env, så etter første gang holder ./start.sh --reload."
fi
if [[ -n "$MODEL" ]] && ! $OLLAMA; then
  fail "--model brukes bare sammen med --ollama: ./start.sh --ollama -m $MODEL"
fi

# --- 2. Model ---------------------------------------------------------------

total_ram_gb() {
  if [[ "$(uname -s)" == "Darwin" ]]; then
    echo $(( $(sysctl -n hw.memsize) / 1024 / 1024 / 1024 ))
  else
    awk '/MemTotal/ {printf "%d", $2 / 1024 / 1024}' /proc/meminfo
  fi
}

# Total VRAM of the largest NVIDIA GPU, or non-zero exit if there is none.
vram_gb() {
  command -v nvidia-smi >/dev/null 2>&1 || return 1
  local mib
  mib="$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null | sort -rn | head -1)"
  [[ -n "$mib" ]] || return 1
  echo $(( mib / 1024 ))
}

MODEL_TIERS=(qwen2.5:0.5b qwen2.5:7b qwen2.5:14b)

tier_for() { # tier_for GB MID_THRESHOLD HIGH_THRESHOLD -> index into MODEL_TIERS
  local gb="$1"
  if   (( gb >= $3 )); then echo 2
  elif (( gb >= $2 )); then echo 1
  else                      echo 0
  fi
}

AUTO_REASON=""

# On Apple Silicon, system RAM is the GPU memory, so RAM is the right number.
# With a discrete NVIDIA card it is not: a model that fits in RAM but not in
# VRAM gets split across the CPU and becomes very slow. Take whichever of the
# two is more restrictive.
#
# Sets MODEL and AUTO_REASON rather than echoing, so the caller does not have
# to run it in a subshell where AUTO_REASON would be lost.
auto_model() {
  local ram tier vram vram_tier
  ram="$(total_ram_gb)"
  tier="$(tier_for "$ram" 12 32)"
  AUTO_REASON="${ram} GB RAM"

  if vram="$(vram_gb)"; then
    vram_tier="$(tier_for "$vram" 6 12)"
    (( vram_tier < tier )) && tier="$vram_tier"
    AUTO_REASON="${ram} GB RAM og ${vram} GB VRAM"
  fi

  MODEL="${MODEL_TIERS[$tier]}"
}

model_size() {
  case "$1" in
    qwen2.5:0.5b) echo "rundt 400 MB" ;;
    qwen2.5:7b)   echo "rundt 4,7 GB" ;;
    qwen2.5:14b)  echo "rundt 9 GB" ;;
    *)            echo "ukjent nedlastingsstørrelse" ;;
  esac
}

# Read a key from .env without sourcing it.
env_value() {
  [[ -f .env ]] || return 0
  grep -E "^${1}=" .env 2>/dev/null | tail -1 | cut -d= -f2- || true
}

# Precedence: --model, then OLLAMA_MODEL in the environment, then .env,
# then automatic. A model someone chose deliberately is never overridden.
resolve_model() {
  [[ -n "$MODEL" ]] && return
  MODEL="${OLLAMA_MODEL:-$(env_value OLLAMA_MODEL)}"
  if [[ -z "$MODEL" ]]; then
    auto_model
    info "valgte $MODEL ut fra $AUTO_REASON"
    if [[ "$MODEL" == "qwen2.5:0.5b" ]]; then
      warn "denne maskinen har lite minne, så den minste modellen ble valgt."
      warn "den svarer, men kvaliteten er dårlig. Uten --ollama er det maltekst."
    fi
  fi
}

# --- 3. Preflight -----------------------------------------------------------

port_in_use() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") >/dev/null 2>&1 && { exec 3<&- ; return 0; }
  return 1
}

# Compose publishes on 127.0.0.1, but a second process can still bind the same port
# on ::1 and make localhost alternate between two different services.
port_in_use_ipv6() {
  curl -g -sS --noproxy '*' -m 1 -o /dev/null "http://[::1]:$1/" >/dev/null 2>&1
}

# Every Node service answers /helse with a "tjeneste" field, so this tells
# our own containers apart from an unrelated process on the same port.
#
# 127.0.0.1 rather than localhost, to match port_in_use above: localhost resolves
# ::1 first on many machines, so the two probes asked different questions. --noproxy
# because an http_proxy in the environment would send the probe to the proxy.
port_is_ours() {
  curl -fsS --noproxy '*' -m 2 "http://127.0.0.1:$1/helse" 2>/dev/null | grep -q '"tjeneste"'
}

port_is_ours_ipv6() {
  curl -fsS -g --noproxy '*' -m 2 "http://[::1]:$1/helse" 2>/dev/null | grep -q '"tjeneste"'
}

preflight() {
  command -v curl >/dev/null 2>&1 || fail "curl er ikke installert, og skriptet trenger den. Hent den med pakkebehandleren din."
  command -v docker >/dev/null 2>&1 || fail "Docker er ikke installert. Hent den fra https://docs.docker.com/get-docker/"

  if ! docker info >/dev/null 2>&1; then
    # On Linux a missing docker group looks the same as a stopped daemon
    # unless we look at the actual error.
    if docker info 2>&1 | grep -qi "permission denied"; then
      fail "Får ikke kontakt med Docker-daemonen: tilgang nektet.
   Legg deg selv til i docker-gruppen, og logg ut og inn igjen:
     sudo usermod -aG docker \$USER"
    fi
    fail "Docker er installert, men kjører ikke. Start Docker og prøv igjen."
  fi
  docker compose version >/dev/null || fail "Docker Compose v2 mangler."
  docker compose config --quiet || fail "Compose-konfigurasjonen er ugyldig."

  local conflicts=()
  local p
  for p in "${SERVICE_PORTS[@]}"; do
    if { port_in_use_ipv6 "$p" && ! port_is_ours_ipv6 "$p"; } \
      || { port_in_use "$p" && ! port_is_ours "$p"; }; then
      conflicts+=("$p")
    fi
  done
  if (( ${#conflicts[@]} > 0 )); then
    fail "Portene er allerede i bruk av noe annet: ${conflicts[*]}
   Stopp det som lytter der, og kjør ./start.sh igjen."
  fi
}

# --- 4. Configuration -------------------------------------------------------

ensure_env() {
  if [[ -f .env ]]; then
    info ".env finnes - lar den stå urørt"
    return
  fi
  [[ -f .env.example ]] || fail ".env.example mangler i repoet."
  cp .env.example .env
  info "opprettet .env fra .env.example"
}

# Replace KEY=... in .env, or append it. Only called for an explicit --ollama, so
# the choice survives a plain --reload, which recreates ai-gateway from .env.
set_env_value() {
  if grep -qE "^${1}=" .env; then
    sed -i.bak -E "s|^${1}=.*|${1}=${2}|" .env && rm -f .env.bak
  else
    printf '%s=%s\n' "$1" "$2" >> .env
  fi
}

remember_ollama() {
  set_env_value AI_PROVIDER ollama
  set_env_value OLLAMA_MODEL "$MODEL"
  # The value every earlier start.sh wrote on Linux and WSL, pointing at the
  # container this repo no longer has.
  if [[ "$(env_value OLLAMA_BASE_URL)" == "http://ollama:11434" ]]; then
    set_env_value OLLAMA_BASE_URL http://host.docker.internal:11434
    info "OLLAMA_BASE_URL pekte på den gamle Ollama-containeren - pekte den om til verten"
  fi
  info "husket i .env: AI_PROVIDER=ollama, OLLAMA_MODEL=$MODEL"
}

# Called only after all Node writers have stopped. Include hidden files and
# directories too; the signing key must never reach a committable directory.
backup_state() {
  local filer=()
  local fil
  for fil in state/* state/.[!.]* state/..?*; do
    [[ -e "$fil" || -L "$fil" ]] || continue
    [[ "${fil##*/}" == digdir-nokkel.json ]] && continue
    filer+=("$fil")
  done
  (( ${#filer[@]} )) || return 0

  local stamp maal nummer=0
  stamp="$(date -u +%Y%m%d-%H%M%S)"
  maal="_backup/${stamp}-utc"
  while [[ -e "$maal" || -L "$maal" ]]; do
    nummer=$(( nummer + 1 ))
    maal="_backup/${stamp}-${nummer}-utc"
  done
  mkdir -p _backup
  mkdir "$maal"
  cp -R "${filer[@]}" "$maal/" || fail "Sikkerhetskopiering feilet. state/ er ikke slettet; tjenestene er stoppet."
  info "tok vare på ${#filer[@]} filer i $maal/"
}

reset_state() {
  [[ ! -L state ]] || fail "state/ er en symbolsk lenke. Avbryter uten å slette."
  [[ ! -e state || -d state ]] || fail "state/ er ikke en mappe. Avbryter uten å slette."
  step "🛑 Stopper alle Node-tjenester før nullstilling"
  docker compose stop "${NODE_SERVICES[@]}" \
    || fail "Kunne ikke stoppe tjenestene. state/ er ikke slettet."
  backup_state
  rm -rf -- state || fail "Kunne ikke tømme state/. Tjenestene er fortsatt stoppet."
  info "kjøretilstanden er tømt - starter fra seed-dataene"
}

confirm() {
  $ASSUME_YES && return 0
  printf '\n   %s\n   Trykk Enter for å fortsette, eller Ctrl-C for å stoppe. ' "$1"
  read -r _ || true
}

wait_for() { # wait_for FUNCTION TIMEOUT_SECONDS MESSAGE
  local fn="$1" timeout="$2" msg="$3" i=0
  while (( i < timeout )); do
    "$fn" && return 0
    sleep 1
    i=$(( i + 1 ))
  done
  fail "$msg"
}

# --- 5. Ollama on the host --------------------------------------------------

# The CLI rather than curl on localhost:11434: it reaches the server wherever it
# is local to the CLI, which is also true for Ollama for Windows under Git Bash.
ollama_up() { ollama list >/dev/null 2>&1; }

ensure_ollama() {
  if ! command -v ollama >/dev/null 2>&1; then
    local hent="Ollama er ikke installert. Hent den fra https://ollama.com/download og kjør ./start.sh --ollama igjen."
    [[ "$(uname -s)" == "Darwin" ]] || fail "$hent"
    [[ ! -d /Applications/Ollama.app ]] \
      || fail "Ollama.app finnes, men kommandoen ollama mangler. Åpne Ollama én gang, så legger den inn kommandoen."
    command -v brew >/dev/null 2>&1 || fail "$hent"
    confirm "Ollama er ikke installert. Dette kjører: brew install ollama"
    brew install ollama
  fi

  ollama_up && { info "Ollama kjører"; return; }

  [[ "$(uname -s)" == "Darwin" ]] || fail "Ollama er installert, men svarer ikke. Start den og prøv igjen:
   Linux: sudo systemctl start ollama    Windows: start Ollama fra Start-menyen"

  info "Ollama svarer ikke - starter den"
  if command -v brew >/dev/null 2>&1 && brew list ollama >/dev/null 2>&1; then
    # brew services survives closing the terminal; "ollama serve" does not.
    brew services start ollama >/dev/null
  elif [[ -d /Applications/Ollama.app ]]; then
    open -a Ollama
  else
    nohup ollama serve >/dev/null 2>&1 &
  fi
  wait_for ollama_up 30 "Ollama kom ikke opp innen 30 sekunder. Prøv: brew services start ollama"
}

model_present() {
  local want="$MODEL"
  [[ "$want" == *:* ]] || want="${want}:latest"
  # grep without -q: an early exit could SIGPIPE awk, and pipefail would read that
  # as "not present".
  ollama list 2>/dev/null | awk 'NR > 1 {print $1}' | grep -xF "$want" >/dev/null
}

# The model is fetched before the services start. If it were pulled after,
# ai-gateway would be live and silently answering with template text for the
# whole download.
ensure_model() {
  if model_present; then
    info "modellen $MODEL er tilgjengelig"
    return
  fi
  confirm "Modellen $MODEL er ikke lastet ned ennå ($(model_size "$MODEL")). Dette henter den."
  ollama pull "$MODEL"
  model_present || fail "Modellen $MODEL er fortsatt ikke tilgjengelig etter nedlastingen."
}

# --- 6. Services ------------------------------------------------------------

# --no-deps, as in start.bat: wait_for_services polls every service itself, so
# NODE_SERVICES must name them all.
start_services() {
  local args=(up -d)
  if $RESET || $RELOAD; then args+=(--force-recreate); fi
  docker compose "${args[@]}" --no-deps "${NODE_SERVICES[@]}"
}

services_healthy() {
  local p
  for p in "${SERVICE_PORTS[@]}"; do
    port_is_ours "$p" || return 1
  done
  return 0
}

# "docker compose up -d" returns once containers are created, not once the
# HTTP servers accept connections. --no-deps also skips dependency health waits,
# so we poll the Node services ourselves on every platform.
wait_for_services() {
  wait_for services_healthy 90 "Tjenestene svarte ikke innen 90 sekunder. Se: docker compose logs"
}

# --- 7. Verify the model is really wired up ---------------------------------

json_field() { # json_field FIELD <<<JSON  -> the string value, unquoted
  grep -o "\"$1\": *\"[^\"]*\"" | sed -E 's/.*: *"(.*)"$/\1/' | head -1
}

# ai-gateway's active provider is whatever /admin last set, which can differ
# from AI_PROVIDER in .env and survives a restart (state/ai-provider-override.json).
# Ask it, rather than assuming - the warning at the bottom used to hardcode
# "Ollama is NOT connected" even when the active provider was Bedrock.
active_provider() {
  curl -fsS -m 5 http://localhost:8082/helse 2>/dev/null | json_field provider
}

verify_provider() { # verify_provider PROVIDER FLAG
  [[ "$(active_provider)" == "$1" ]] || fail "$2 ble overstyrt av et lagret admin-valg, eller KI-statusen kunne ikke leses.
   Velg $1 på http://localhost:8082/admin og prøv igjen.
   Vil du nullstille hele kjøringen, bruk ./start.sh $2 --reset."
}

# A real call, not just /helse: /helse's bedrock/openrouter/telenor-ai-factory check only
# confirms credentials are *configured*, not that a call actually succeeds - so
# only an end-to-end call here can tell a working setup from a broken one.
verify_llm() {
  local response
  response="$(curl -fsS -m 180 -X POST http://localhost:8082/ai/klarsprak \
    -H 'Content-Type: application/json' \
    -d '{"kontekst":{"tjeneste":"oppstartssjekk"},"sprak":"nb"}' 2>/dev/null || true)"

  if [[ -z "$response" ]]; then
    warn "ai-gateway svarte ikke på verifiseringskallet"
    return 1
  fi
  if grep -q '"advarsel"' <<<"$response"; then
    warn "ai-gateway falt tilbake til malsvar:"
    printf '      %s\n' "$(grep -o '"advarsel": *"[^"]*"' <<<"$response")"
    return 1
  fi
  VERIFIED_MODEL="$(json_field modell <<<"$response")"
  # The advarsel check above cannot see the one case this whole step exists for.
  # A template answer carries no advarsel at all - it only names itself in
  # `modell` - so a gateway running mock (from AI_PROVIDER, or from a /admin
  # choice stored in state/ai-provider-override.json that outlives a restart)
  # would be reported as a confirmed working model.
  if [[ "$VERIFIED_MODEL" == "mock-ai-gateway" ]]; then
    warn "ai-gateway svarte med malsvar, ikke fra en modell."
    warn "den aktive leverandøren er mock - se http://localhost:8082/admin,"
    warn "som overstyrer AI_PROVIDER og overlever en omstart."
    return 1
  fi
}

# --- Run --------------------------------------------------------------------

if $DOWN; then
  step "🛑 Stopper workshop-ai"
  docker compose down -t 0
  printf '\n✅ Stoppet.\n\n'
  exit 0
fi

if $RELOAD; then
  step "🔄 Laster Node-tjenestene på nytt"
  # --mock has to be exported here too, not only on the start path below, which
  # this branch exits before reaching. "up -d" recreates the container from the
  # current environment, so without this line a --mock --reload silently swaps
  # working template text for whatever AI_PROVIDER .env names - and the first
  # code change a participant makes turns into "the model is not connected".
  if $MOCK; then
    export AI_PROVIDER=mock
  fi
  preflight
  start_services
  wait_for_services
  if $MOCK; then verify_provider mock --mock; fi
  info "alle ${#NODE_SERVICES[@]} tjenestene er lastet på nytt"
  printf '\n✅ Klar - kodeendringene er i drift.\n\n'
  exit 0
fi

step "🚀 Starter workshop-ai"
if $MOCK; then export AI_PROVIDER=mock; fi
if $OLLAMA; then
  resolve_model
  export AI_PROVIDER=ollama OLLAMA_MODEL="$MODEL"
  info "Modell: $MODEL i Ollama på denne maskinen"
fi

step "🔎 Sjekker forutsetninger"
preflight
ensure_env

if $OLLAMA; then
  step "🦙 Klargjør Ollama"
  ensure_ollama
  ensure_model
  remember_ollama
fi

# Downloads and configuration checks come before stopping writers or clearing data.
if $RESET; then reset_state; fi

step "📦 Starter tjenestene"
start_services
wait_for_services
if $MOCK; then verify_provider mock --mock; fi
if $OLLAMA; then verify_provider ollama --ollama; fi
info "alle ${#NODE_SERVICES[@]} tjenestene svarer"

# || true: under set -e a /helse that cannot be read would end the script here.
PROVIDER="$(active_provider || true)"
LLM_OK=false
VERIFIED_MODEL=""
if [[ "$PROVIDER" != mock ]]; then
  step "🔌 Verifiserer at modellen er koblet til"
  if verify_llm; then
    LLM_OK=true
    info "bekreftet: ai-gateway bruker $VERIFIED_MODEL"
  fi
fi

printf '\n✅ Klar\n'
printf '\n   Les først:\n'
printf '   📖 Hva du skal bygge: docs/oppdraget.md\n'
printf '   🚀 Kom i gang:        docs/deltakerstart.md\n'
printf '   🔨 Bygg ditt eget:    docs/bygg-selv.md\n'
printf '\n   Oversikt og API-er:\n'
printf '   🧭 Dashbord:          http://localhost:3001\n'
printf '   🧪 API-utforsker:     http://localhost:3001/utforsker\n'
printf '   📚 API-dokumentasjon: http://localhost:8080/docs\n'
printf '\n   Referanseklienter - eksempler, ikke fasiten:\n'
printf '   📝 Stegvis grensesnitt: http://localhost:3001/stegvis\n'
printf '   🌐 Chat:                http://localhost:3001/chat\n'
printf '   🧠 Agent:               http://localhost:3001/agent\n'
printf '   🔧 Prosessbygger:       http://localhost:3000\n'
printf '\n   Når KI-en ser feil ut:\n'
printf '   🔍 KI-spor:           http://localhost:8082/trace\n'
printf '   🔀 KI-leverandør:     http://localhost:8082/admin\n'

if [[ "$PROVIDER" == mock ]]; then
  printf '\n   ⚠️  KI-leverandøren er mock: svarene er ferdigskrevet maltekst, ikke en modell.\n'
  printf '       Lokal modell: ./start.sh --ollama. Andre leverandører: http://localhost:8082/admin.\n'
elif ! $LLM_OK; then
  # The active provider is whatever /admin last set, so the warning below names
  # the provider actually configured, not a fixed guess.
  case "$PROVIDER" in
    bedrock)
      printf '\n   ⚠️  Leverandøren er satt til AWS Bedrock, men den svarte ikke. Svarene ser\n'
      printf '       normale ut, men kommer fra maler. Sjekk legitimasjon og modelltilgang\n'
      printf '       på http://localhost:8082/admin - og om kontoen har sendt inn\n'
      printf '       Anthropics bruksskjema (Bedrock-konsollet -> Model access).\n'
      ;;
    openrouter)
      printf '\n   ⚠️  Leverandøren er satt til OpenRouter, men den svarte ikke. Svarene ser\n'
      printf '       normale ut, men kommer fra maler. Sjekk OPENROUTER_API_KEY, eller\n'
      printf '       bytt leverandør på http://localhost:8082/admin.\n'
      ;;
    telenor-ai-factory)
      printf '\n   ⚠️  Leverandøren er satt til Telenor AI Factory, men den svarte ikke.\n'
      printf '       Svarene ser normale ut, men kommer fra maler. Sjekk API-nøkkelen\n'
      printf '       og modelltilgangen på http://localhost:8082/admin.\n'
      ;;
    ollama)
      printf '\n   ⚠️  Leverandøren er satt til Ollama, men den svarte ikke. Svarene ser normale\n'
      printf '       ut, men kommer fra maler. ./start.sh --ollama starter Ollama og henter\n'
      printf '       modellen. På Linux lytter Ollama bare på 127.0.0.1, så containeren når den\n'
      printf '       ikke før OLLAMA_HOST er satt - se apps/ai-gateway/README.md.\n'
      ;;
    *)
      printf '\n   ⚠️  Den aktive leverandøren svarte ikke. Svarene ser normale ut, men\n'
      printf '       kommer fra maler. Se http://localhost:8082/admin.\n'
      ;;
  esac
fi

printf '\n   Stopp med: ./start.sh -d\n\n'
