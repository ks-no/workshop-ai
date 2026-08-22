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
# mcp-services proxies its three matrikkel_* tools to it over MATRIKKEL_BASE_URL.
# Leave it out and those tools fail with "fetch failed" while everything else looks fine.
# digdir-mock must stay in this list for the same reason as matrikkel-mock: on
# macOS we start only these by name, and everything that needs a token dials it.
# Leave it out and every authenticated call fails while the stack looks healthy.
NODE_SERVICES=(sandbox-backend fiks-simulator ai-gateway mcp-services process-agent matrikkel-mock digdir-mock demo-gui process-builder)
SERVICE_PORTS=(8080 8081 8082 8083 8084 8085 8086 3000 3001)
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
Usage: ./start.sh [OPTIONS]

Starts the sandbox. Platform, GPU and model are detected automatically —
you should not need any options.

Options:
  -m, --model MODEL  Use a specific Ollama model instead of the auto-selected one
  -y, --yes          Do not ask before installing Ollama or downloading a model
      --mock         Run without a language model (AI replies become templates)
      --reset        Wipe runtime state in state/ and start from the seed data
      --reload       Restart Node services to pick up code changes, then exit
  -d, --down         Stop and remove all containers
  -h, --help         Show this help

Recommended models:
  qwen2.5:0.5b       Fastest, lowest quality (about 400 MB)
  qwen2.5:7b         Best default balance (about 4.7 GB)
  qwen2.5:14b        Better quality if you have enough RAM/VRAM (about 9 GB)
  llama3.1:8b        Strong alternative to qwen2.5:7b (about 4.9 GB)
  mistral-nemo       Good multilingual option (about 7 GB)

Tip:
  The script auto-selects a model based on RAM/VRAM.
  Use --model only if you want to override that choice.

Examples:
  ./start.sh                  # just start it
  ./start.sh -y               # unattended, including downloads
  ./start.sh -m qwen2.5:7b    # smaller model
  ./start.sh -m qwen2.5:14b   # better quality, heavier
  ./start.sh -m llama3.1:8b   # alternative model family
  ./start.sh --mock           # no model — useful on a bad connection
  ./start.sh --reset          # forget every earlier demo run
  ./start.sh --reload         # restart services after a code change
  ./start.sh -d               # stop everything
EOF
}

# --- 1. Arguments -----------------------------------------------------------

while [[ $# -gt 0 ]]; do
  case "$1" in
    -m|--model) MODEL="${2:-}"; [[ -n "$MODEL" ]] || fail "--model needs a value"; shift 2 ;;
    -y|--yes)   ASSUME_YES=true; shift ;;
    --mock)     MOCK=true; shift ;;
    --reset)    RESET=true; shift ;;
    --reload)   RELOAD=true; shift ;;
    -d|--down)  DOWN=true; shift ;;
    -h|--help)  usage; exit 0 ;;
    -g|--gpu|-p|--pull)
      # Kept so older commands do not break. Both are automatic now.
      warn "$1 is no longer needed — GPU and model download are detected automatically"
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
    AUTO_REASON="${ram} GB RAM and ${vram} GB VRAM"
  fi

  MODEL="${MODEL_TIERS[$tier]}"
}

model_size() {
  case "$1" in
    qwen2.5:0.5b) echo "about 400 MB" ;;
    qwen2.5:7b)   echo "about 4.7 GB" ;;
    qwen2.5:14b)  echo "about 9 GB" ;;
    llama3.1:8b)  echo "about 4.9 GB" ;;
    mistral-nemo) echo "about 7 GB" ;;
    *)            echo "download size unknown" ;;
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
    info "selected $MODEL based on $AUTO_REASON"
    if [[ "$MODEL" == "qwen2.5:0.5b" ]]; then
      warn "this machine has little memory, so the smallest model was chosen."
      warn "it answers, but the quality is poor. --mock is often just as useful."
    fi
  fi
}

# --- 3. Preflight -----------------------------------------------------------

port_in_use() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") >/dev/null 2>&1 && { exec 3<&- ; return 0; }
  return 1
}

# Every Node service answers /health with a "tjeneste" field, so this tells
# our own containers apart from an unrelated process on the same port.
port_is_ours() {
  curl -fsS -m 2 "http://localhost:$1/health" 2>/dev/null | grep -q '"tjeneste"'
}

preflight() {
  command -v curl >/dev/null 2>&1 || fail "curl is not installed, and this script needs it. Install it with your package manager."
  command -v docker >/dev/null 2>&1 || fail "Docker is not installed. See https://docs.docker.com/get-docker/"

  if ! docker info >/dev/null 2>&1; then
    # On Linux a missing docker group looks the same as a stopped daemon
    # unless we look at the actual error.
    if docker info 2>&1 | grep -qi "permission denied"; then
      fail "Cannot reach the Docker daemon: permission denied.
   Add yourself to the docker group, then log out and back in:
     sudo usermod -aG docker \$USER"
    fi
    fail "Docker is installed but not running. Start Docker and try again."
  fi

  local conflicts=()
  local p
  for p in "${SERVICE_PORTS[@]}"; do
    if port_in_use "$p" && ! port_is_ours "$p"; then
      conflicts+=("$p")
    fi
  done
  if (( ${#conflicts[@]} > 0 )); then
    fail "Ports already used by something else: ${conflicts[*]}
   Stop whatever is listening there, then run ./start.sh again."
  fi
}

# --- 4. Configuration -------------------------------------------------------

ensure_env() {
  if [[ -f .env ]]; then
    info ".env exists — leaving it untouched"
    return
  fi
  [[ -f .env.example ]] || fail ".env.example is missing from the repo."

  local base_url="http://ollama:11434"
  [[ "$PROFILE" == "macos-native" ]] && base_url="http://host.docker.internal:11434"

  cp .env.example .env
  sed -i.bak -E "s|^OLLAMA_BASE_URL=.*|OLLAMA_BASE_URL=${base_url}|" .env
  sed -i.bak -E "s|^OLLAMA_MODEL=.*|OLLAMA_MODEL=${MODEL}|" .env
  rm -f .env.bak
  info "created .env pointing at ${base_url}"
}

confirm() {
  $ASSUME_YES && return 0
  printf '\n   %s\n   Press Enter to continue, or Ctrl-C to stop. ' "$1"
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
    command -v brew >/dev/null 2>&1 || fail "Ollama is not installed. Get it from https://ollama.com/download and run ./start.sh again."
    confirm "Ollama is not installed. This will run: brew install ollama"
    brew install ollama
  fi

  ollama_up && { info "Ollama is running"; return; }

  info "Ollama is not responding — starting it"
  if command -v brew >/dev/null 2>&1 && brew list ollama >/dev/null 2>&1; then
    # brew services survives closing the terminal; "ollama serve" does not.
    brew services start ollama >/dev/null
  elif [[ -d /Applications/Ollama.app ]]; then
    open -a Ollama
  else
    nohup ollama serve >/dev/null 2>&1 &
  fi
  wait_for ollama_up 30 "Ollama did not come up within 30s. Try: brew services start ollama"
}

ensure_ollama_container() {
  docker compose "${COMPOSE_FILES[@]}" up -d ollama
  wait_for ollama_up 60 "The ollama container did not become reachable on port ${OLLAMA_PORT}."
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
    info "model $MODEL is available"
    return
  fi
  confirm "Model $MODEL is not downloaded yet ($(model_size "$MODEL")). This will fetch it."
  pull_model
  model_present || fail "Model $MODEL still not available after download."
}

# --- 6. Services ------------------------------------------------------------

start_services() {
  if [[ "$PROFILE" == "macos-native" ]]; then
    # --no-deps because ai-gateway depends_on the ollama container, which we
    # deliberately do not use here.
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
# Ask it, rather than assuming ollama — the warning at the bottom used to
# hardcode "Ollama is NOT connected" even when the active provider was Bedrock.
active_provider() {
  curl -fsS -m 5 http://localhost:8082/helse 2>/dev/null | json_field provider
}

# A real call, not just /helse: /helse's own bedrock/openrouter check only
# confirms credentials are *configured*, not that a call actually succeeds — so
# only an end-to-end call here can tell a working setup from a broken one.
verify_llm() {
  local response
  response="$(curl -fsS -m 180 -X POST http://localhost:8082/ai/klarsprak \
    -H 'Content-Type: application/json' \
    -d '{"kontekst":{"tjeneste":"oppstartssjekk"},"sprak":"nb"}' 2>/dev/null || true)"

  if [[ -z "$response" ]]; then
    warn "ai-gateway did not answer the verification call"
    return 1
  fi
  if grep -q '"advarsel"' <<<"$response"; then
    warn "ai-gateway fell back to template text:"
    printf '      %s\n' "$(grep -o '"advarsel": *"[^"]*"' <<<"$response")"
    return 1
  fi
  VERIFIED_MODEL="$(json_field modell <<<"$response")"
}

# --- Run --------------------------------------------------------------------

detect_platform

if $DOWN; then
  step "🛑 Stopping workshop-ai"
  docker compose "${COMPOSE_FILES[@]}" down -t 0
  printf '\n✅ Stopped.\n\n'
  exit 0
fi

if $RELOAD; then
  step "🔄 Reloading Node services"
  # Use the same up-path as start_services so platform differences are respected.
  # "up -d" recreates a container when its config (e.g. command:) has changed;
  # plain "restart" reuses the old container and never picks up compose changes.
  if [[ "$PROFILE" == "macos-native" ]]; then
    docker compose "${COMPOSE_FILES[@]}" up -d --no-deps "${NODE_SERVICES[@]}"
  else
    docker compose "${COMPOSE_FILES[@]}" up -d "${NODE_SERVICES[@]}"
  fi
  wait_for_services
  info "all ${#NODE_SERVICES[@]} services have reloaded"
  printf '\n✅ Ready — code changes are live.\n\n'
  exit 0
fi

step "🚀 Starting workshop-ai"
info "Platform: $PROFILE"

if $MOCK; then
  export AI_PROVIDER=mock
  info "Model:    none (--mock)"
else
  resolve_model
  export OLLAMA_MODEL="$MODEL"
  info "Model:    $MODEL"
fi

step "🔎 Checking prerequisites"
preflight
ensure_env

if $RESET; then
  # Services seed themselves from data/ whenever a state file is missing,
  # so removing the directory is all it takes.
  rm -rf state
  info "runtime state cleared — starting from the seed data"
fi

if ! $MOCK; then
  step "🦙 Preparing the language model"
  case "$PROFILE" in
    macos-native) ensure_ollama_native ;;
    *)            ensure_ollama_container ;;
  esac
  ensure_model
fi

step "📦 Starting services"
start_services
wait_for_services
info "all ${#NODE_SERVICES[@]} services are responding"

LLM_OK=false
VERIFIED_MODEL=""
if ! $MOCK; then
  step "🔌 Verifying that the model is connected"
  if verify_llm; then
    LLM_OK=true
    info "confirmed: ai-gateway is using $VERIFIED_MODEL"
  fi
fi

printf '\n✅ Ready\n'
printf '   🧭 Start here:      http://localhost:3001\n'
printf '   🌐 Chat:            http://localhost:3001/chat\n'
printf '   🧠 Agent:           http://localhost:3001/agent\n'
printf '   📝 Step-by-step UI: http://localhost:3001/stegvis\n'
printf '   🔧 Process Builder: http://localhost:3000\n'
printf '   🔍 AI trace:        http://localhost:8082/trace\n'
printf '   🔀 AI provider:     http://localhost:8082/admin\n'
printf '   📚 API docs:        http://localhost:8080/docs\n'

if $MOCK; then
  printf '\n   ⚠️  Running with --mock: AI replies are canned template text, not a model.\n'
elif ! $LLM_OK; then
  # The active provider is whatever /admin last set — not necessarily ollama —
  # so the warning below names the provider actually configured, not a fixed guess.
  case "$(active_provider)" in
    bedrock)
      printf '\n   ⚠️  Provider is set to AWS Bedrock, but it did not answer. Replies will\n'
      printf '       look normal but come from templates. Check credentials and model access\n'
      printf '       at http://localhost:8082/admin — and whether the account has submitted\n'
      printf '       the Anthropic use-case form (Bedrock console -> Model access).\n'
      ;;
    openrouter)
      printf '\n   ⚠️  Provider is set to OpenRouter, but it did not answer. Replies will\n'
      printf '       look normal but come from templates. Check OPENROUTER_API_KEY, or\n'
      printf '       switch provider at http://localhost:8082/admin.\n'
      ;;
    ollama|"")
      printf '\n   ⚠️  Ollama is NOT connected. Replies will look normal but come from\n'
      printf '       templates. Check that Ollama is running, then start again.\n'
      ;;
    *)
      printf '\n   ⚠️  The active provider did not answer. Replies will look normal but\n'
      printf '       come from templates. Check http://localhost:8082/admin.\n'
      ;;
  esac
fi

printf '\n   Stop with: ./start.sh -d\n\n'
