#!/usr/bin/env bash
#
# One-command start for the innbyggerdialog sandbox.
#
# Detects your platform, makes sure a local language model is available,
# starts the services, and verifies that the model is actually reachable
# before reporting success.
#
# That last step matters: ai-gateway falls back to template text when the
# model is unreachable, and the responses look perfectly fine. Without an
# explicit check you cannot tell a working setup from a broken one.

set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Services that run in Docker on every platform.
# matrikkel-mock must stay in this list: on macOS we start only these by name, and
# tools-api proxies its three matrikkel_* tools to it over MATRIKKEL_BASE_URL.
# Leave it out and those tools fail with "fetch failed" while everything else looks fine.
# digdir-mock must stay in this list for the same reason as matrikkel-mock: on
# macOS we start only these by name, and everything that needs a token dials it.
# Leave it out and every authenticated call fails while the stack looks healthy.
NODE_SERVICES=(sandbox-backend fiks-simulator ai-gateway tools-api process-agent matrikkel-mock digdir-mock pasientjournal-mock politiattest-mock demo-gui process-builder)
SERVICE_PORTS=(8080 8081 8082 8083 8084 8085 8086 8087 8088 3000 3001)
OLLAMA_PORT=11434

MODEL=""
ASSUME_YES=false
DOWN=false
MOCK=false
RESET=false
RELOAD=false
PROFILE=""
COMPOSE_FILES=(-f docker-compose.yml)

step() { printf '\n%s\n' "$*"; }
info() { printf '   %s\n' "$*"; }
warn() { printf '   ⚠️  %s\n' "$*"; }
fail() { printf '\n❌ %s\n\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Bruk: ./start.sh [VALG]

Starter sandkassen. Plattform, GPU og modell oppdages automatisk - du skal ikke
trenge noen valg.

Valg:
  -m, --model MODELL Bruk en bestemt Ollama-modell i stedet for den automatiske
  -y, --yes          Ikke spør før Ollama installeres eller en modell lastes ned
      --mock         Kjør uten språkmodell (KI-svarene blir maler)
      --reset        Tøm kjøretilstanden i state/ og start fra seed-dataene
      --reload       Start Node-tjenestene på nytt for å ta inn kodeendringer, og avslutt
  -d, --down         Stopp og fjern alle containere
  -h, --help         Vis denne hjelpen

Anbefalte modeller:
  qwen2.5:0.5b       Raskest, lavest kvalitet (rundt 400 MB)
  qwen2.5:7b         Best balanse som standard (rundt 4,7 GB)
  qwen2.5:14b        Bedre kvalitet hvis du har nok RAM/VRAM (rundt 9 GB)
  llama3.1:8b        Sterkt alternativ til qwen2.5:7b (rundt 4,9 GB)
  mistral-nemo       Godt flerspråklig alternativ (rundt 7 GB)

Tips:
  Skriptet velger modell selv ut fra RAM/VRAM.
  Bruk --model bare hvis du vil overstyre det valget.

Eksempler:
  ./start.sh                  # bare start
  ./start.sh -y               # uten spørsmål, nedlastinger inkludert
  ./start.sh -m qwen2.5:7b    # mindre modell
  ./start.sh -m qwen2.5:14b   # bedre kvalitet, tyngre
  ./start.sh -m llama3.1:8b   # annen modellfamilie
  ./start.sh --mock           # ingen modell - nyttig på dårlig linje
  ./start.sh --reset          # glem alle tidligere demokjøringer
  ./start.sh --reload         # start tjenestene på nytt etter en kodeendring
  ./start.sh -d               # stopp alt
EOF
}

# --- 1. Arguments -----------------------------------------------------------

while [[ $# -gt 0 ]]; do
  case "$1" in
    -m|--model) MODEL="${2:-}"; [[ -n "$MODEL" ]] || fail "--model trenger en verdi"; shift 2 ;;
    -y|--yes)   ASSUME_YES=true; shift ;;
    --mock)     MOCK=true; shift ;;
    --reset)    RESET=true; shift ;;
    --reload)   RELOAD=true; shift ;;
    -d|--down)  DOWN=true; shift ;;
    -h|--help)  usage; exit 0 ;;
    -g|--gpu|-p|--pull)
      # Kept so older commands do not break. Both are automatic now.
      warn "$1 trengs ikke lenger - GPU og modellnedlasting oppdages automatisk"
      shift ;;
    *) printf 'Unknown option: %s\n\n' "$1" >&2; usage; exit 1 ;;
  esac
done

# --- 2. Platform and model --------------------------------------------------

detect_platform() {
  if [[ "$(uname -s)" == "Darwin" ]]; then
    # Docker Desktop on macOS cannot reach Metal, so a containerised Ollama
    # would be CPU-only. We run Ollama natively and only the Node services
    # in Docker.
    PROFILE="macos-native"
  elif command -v nvidia-smi >/dev/null 2>&1 && docker info 2>/dev/null | grep -qi nvidia; then
    PROFILE="linux-gpu"
    COMPOSE_FILES+=(-f docker-compose.gpu.yml)
  elif grep -qi microsoft /proc/version 2>/dev/null; then
    PROFILE="wsl-cpu"
  else
    PROFILE="linux-cpu"
  fi
}

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
    llama3.1:8b)  echo "rundt 4,9 GB" ;;
    mistral-nemo) echo "rundt 7 GB" ;;
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
      warn "den svarer, men kvaliteten er dårlig. --mock er ofte like nyttig."
    fi
  fi
}

# --- 3. Preflight -----------------------------------------------------------

port_in_use() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") >/dev/null 2>&1 && { exec 3<&- ; return 0; }
  return 1
}

# Every Node service answers /helse with a "tjeneste" field, so this tells
# our own containers apart from an unrelated process on the same port.
port_is_ours() {
  curl -fsS -m 2 "http://localhost:$1/helse" 2>/dev/null | grep -q '"tjeneste"'
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

  local conflicts=()
  local p
  for p in "${SERVICE_PORTS[@]}"; do
    if port_in_use "$p" && ! port_is_ours "$p"; then
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

  local base_url="http://ollama:11434"
  [[ "$PROFILE" == "macos-native" ]] && base_url="http://host.docker.internal:11434"

  cp .env.example .env
  sed -i.bak -E "s|^OLLAMA_BASE_URL=.*|OLLAMA_BASE_URL=${base_url}|" .env
  sed -i.bak -E "s|^OLLAMA_MODEL=.*|OLLAMA_MODEL=${MODEL}|" .env
  rm -f .env.bak
  info "opprettet .env som peker på ${base_url}"
}

confirm() {
  $ASSUME_YES && return 0
  printf '\n   %s\n   Trykk Enter for å fortsette, eller Ctrl-C for å stoppe. ' "$1"
  read -r _ || true
}

# --- 5. Ollama --------------------------------------------------------------

# Both profiles publish Ollama on localhost:11434, so one check covers each.
ollama_up() { curl -fsS -m 2 "http://localhost:${OLLAMA_PORT}/api/tags" >/dev/null 2>&1; }

wait_for() { # wait_for FUNCTION TIMEOUT_SECONDS MESSAGE
  local fn="$1" timeout="$2" msg="$3" i=0
  while (( i < timeout )); do
    "$fn" && return 0
    sleep 1
    i=$(( i + 1 ))
  done
  fail "$msg"
}

ensure_ollama_native() {
  if ! command -v ollama >/dev/null 2>&1 && [[ ! -d /Applications/Ollama.app ]]; then
    command -v brew >/dev/null 2>&1 || fail "Ollama er ikke installert. Hent den fra https://ollama.com/download og kjør ./start.sh igjen."
    confirm "Ollama er ikke installert. Dette kjører: brew install ollama"
    brew install ollama
  fi

  ollama_up && { info "Ollama kjører"; return; }

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

ensure_ollama_container() {
  docker compose "${COMPOSE_FILES[@]}" up -d ollama
  wait_for ollama_up 60 "Ollama-containeren ble ikke tilgjengelig på port ${OLLAMA_PORT}."
}

model_present() {
  local want="$MODEL"
  [[ "$want" == *:* ]] || want="${want}:latest"
  curl -fsS -m 5 "http://localhost:${OLLAMA_PORT}/api/tags" 2>/dev/null | grep -q "\"${want}\""
}

pull_model() {
  if [[ "$PROFILE" == "macos-native" ]]; then
    ollama pull "$MODEL"
  else
    docker compose "${COMPOSE_FILES[@]}" exec -T ollama ollama pull "$MODEL"
  fi
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
  pull_model
  model_present || fail "Modellen $MODEL er fortsatt ikke tilgjengelig etter nedlastingen."
}

# --- 6. Services ------------------------------------------------------------

start_services() {
  if [[ "$PROFILE" == "macos-native" ]] || $MOCK; then
    # --no-deps because ai-gateway depends_on the ollama container, which we
    # deliberately do not use here: on macOS Ollama runs natively on the host,
    # and with --mock no model is used at all. Naming the services explicitly is
    # what keeps the 4 GB ollama image from being pulled - it has no profile, so
    # a bare "up -d" would start it even under --mock, on exactly the bad
    # connection that flag exists for.
    docker compose "${COMPOSE_FILES[@]}" up -d --no-deps "${NODE_SERVICES[@]}"
  else
    docker compose "${COMPOSE_FILES[@]}" up -d
  fi
}

services_healthy() {
  local p
  for p in "${SERVICE_PORTS[@]}"; do
    port_is_ours "$p" || return 1
  done
  return 0
}

# "docker compose up -d" returns once containers are created, not once the
# HTTP servers accept connections. Only the ollama service has a healthcheck
# in docker-compose.yml, so we poll the Node services ourselves.
wait_for_services() {
  wait_for services_healthy 90 "Services did not become healthy within 90s. Check: docker compose logs"
}

# --- 7. Verify the model is really wired up ---------------------------------

json_field() { # json_field FIELD <<<JSON  -> the string value, unquoted
  grep -o "\"$1\": *\"[^\"]*\"" | sed -E 's/.*: *"(.*)"$/\1/' | head -1
}

# ai-gateway's active provider is whatever /admin last set, which can differ
# from AI_PROVIDER in .env and survives a restart (state/ai-provider-override.json).
# Ask it, rather than assuming ollama - the warning at the bottom used to
# hardcode "Ollama is NOT connected" even when the active provider was Bedrock.
active_provider() {
  curl -fsS -m 5 http://localhost:8082/helse 2>/dev/null | json_field provider
}

# A real call, not just /helse: /helse's own bedrock/openrouter check only
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

detect_platform

if $DOWN; then
  step "🛑 Stopper workshop-ai"
  docker compose "${COMPOSE_FILES[@]}" down -t 0
  printf '\n✅ Stoppet.\n\n'
  exit 0
fi

if $RELOAD; then
  step "🔄 Laster Node-tjenestene på nytt"
  # --mock has to be exported here too, not only on the start path below, which
  # this branch exits before reaching. "up -d" recreates the container from the
  # current environment, so without this line a --mock --reload silently swaps
  # working template text for AI_PROVIDER=ollama out of .env - and the first
  # code change a participant makes turns into "the model is not connected".
  if $MOCK; then
    export AI_PROVIDER=mock
  fi
  # Use the same up-path as start_services so platform differences are respected.
  # "up -d" recreates a container when its config (e.g. command:) has changed;
  # plain "restart" reuses the old container and never picks up compose changes.
  if [[ "$PROFILE" == "macos-native" ]] || $MOCK; then
    docker compose "${COMPOSE_FILES[@]}" up -d --no-deps "${NODE_SERVICES[@]}"
  else
    docker compose "${COMPOSE_FILES[@]}" up -d "${NODE_SERVICES[@]}"
  fi
  wait_for_services
  info "alle ${#NODE_SERVICES[@]} tjenestene er lastet på nytt"
  printf '\n✅ Klar - kodeendringene er i drift.\n\n'
  exit 0
fi

step "🚀 Starter workshop-ai"
info "Plattform: $PROFILE"

if $MOCK; then
  export AI_PROVIDER=mock
  info "Modell:    ingen (--mock)"
else
  resolve_model
  export OLLAMA_MODEL="$MODEL"
  info "Modell:    $MODEL"
fi

step "🔎 Sjekker forutsetninger"
preflight
ensure_env

if $RESET; then
  # Services seed themselves from data/ whenever a state file is missing,
  # so removing the directory is all it takes.
  rm -rf state
  info "kjøretilstanden er tømt - starter fra seed-dataene"
fi

if ! $MOCK; then
  step "🦙 Klargjør språkmodellen"
  case "$PROFILE" in
    macos-native) ensure_ollama_native ;;
    *)            ensure_ollama_container ;;
  esac
  ensure_model
fi

step "📦 Starter tjenestene"
start_services
wait_for_services
info "alle ${#NODE_SERVICES[@]} tjenestene svarer"

LLM_OK=false
VERIFIED_MODEL=""
if ! $MOCK; then
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

if $MOCK; then
  printf '\n   ⚠️  Kjører med --mock: KI-svarene er ferdigskrevet maltekst, ikke en modell.\n'
elif ! $LLM_OK; then
  # The active provider is whatever /admin last set - not necessarily ollama -
  # so the warning below names the provider actually configured, not a fixed guess.
  case "$(active_provider)" in
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
    ollama|"")
      printf '\n   ⚠️  Ollama er IKKE koblet til. Svarene ser normale ut, men kommer fra\n'
      printf '       maler. Sjekk at Ollama kjører, og start på nytt.\n'
      ;;
    *)
      printf '\n   ⚠️  Den aktive leverandøren svarte ikke. Svarene ser normale ut, men\n'
      printf '       kommer fra maler. Se http://localhost:8082/admin.\n'
      ;;
  esac
fi

printf '\n   Stopp med: ./start.sh -d\n\n'
