#!/usr/bin/env bash
set -e

GPU=false
MODEL="${OLLAMA_MODEL:-qwen2.5:7b}"
PULL=false
DOWN=false

usage() {
  echo "Usage: ./start.sh [OPTIONS]"
  echo ""
  echo "Options:"
  echo "  -g, --gpu          Enable GPU mode (NVIDIA)"
  echo "  -m, --model MODEL  Set Ollama model (default: qwen2.5:7b)"
  echo "  -p, --pull         Pull the model before starting"
  echo "  -d, --down         Stop and remove all containers"
  echo "  -h, --help         Show this help message"
  echo ""
  echo "Examples:"
  echo "  ./start.sh                        # CPU mode, default model"
  echo "  ./start.sh -g                     # GPU mode, default model"
  echo "  ./start.sh -m qwen2.5:14b -p      # Custom model, pull it first"
  echo "  ./start.sh -g -m llama3.1:8b -p   # GPU + custom model + pull"
  echo "  ./start.sh -d                     # Stop everything"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -g|--gpu)   GPU=true; shift ;;
    -p|--pull)  PULL=true; shift ;;
    -d|--down)  DOWN=true; shift ;;
    -m|--model) MODEL="$2"; shift 2 ;;
    -h|--help)  usage; exit 0 ;;
    *) echo "Unknown option: $1"; usage; exit 1 ;;
  esac
done

export OLLAMA_MODEL="$MODEL"

COMPOSE_FILES="-f docker-compose.yml"
if $GPU; then
  COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.gpu.yml"
fi

if $DOWN; then
  echo "🛑 Stopping all containers..."
  docker compose $COMPOSE_FILES down
  echo "✅ Done."
  exit 0
fi

echo "🚀 Starting workshop-ai"
echo "   Mode:  $(if $GPU; then echo 'GPU (NVIDIA)'; else echo 'CPU'; fi)"
echo "   Model: $MODEL"
echo ""

docker compose $COMPOSE_FILES up -d

if $PULL; then
  echo ""
  echo "📦 Pulling model: $MODEL"
  docker compose $COMPOSE_FILES --profile pull up ollama-pull-selected
fi

echo ""
echo "✅ All services running:"
echo "   🌐 Chat:            http://localhost:3001/chat"
echo "   🔧 Process Builder: http://localhost:3000"
echo "   🤖 AI Gateway:      http://localhost:8082"
echo "   📦 Sandbox Backend: http://localhost:8080"
echo "   🔌 MCP Services:    http://localhost:8083"
echo "   🧠 Process Agent:   http://localhost:8084"
echo "   🦙 Ollama:          http://localhost:11434"

