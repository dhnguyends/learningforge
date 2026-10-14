#!/usr/bin/env bash
# Start LectureForge's processes on a packet.ai pod. Pods may run without
# systemd (and dynamic pods restart during maintenance), so this script is
# the single, re-runnable way to bring everything up.
#
#   bash deploy/packet/start.sh          # infra + app
#   bash deploy/packet/start.sh infra    # PostgreSQL + Ollama only
#   bash deploy/packet/start.sh app      # (re)start the Next.js server
#   bash deploy/packet/start.sh status
#   bash deploy/packet/start.sh stop-app
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
DATA_DIR="${DATA_DIR:-/home/ubuntu/lectureforge-data}"
APP_PORT="${APP_PORT:-3000}"
PG_VERSION=16
LOGS="$DATA_DIR/logs"
SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"
mkdir -p "$LOGS"

has_systemd() { [ "$(ps -p 1 -o comm= 2>/dev/null)" = "systemd" ]; }

start_postgres() {
  if $SUDO -u postgres pg_isready -q 2>/dev/null; then return; fi
  if has_systemd; then
    $SUDO systemctl enable --now postgresql >/dev/null
  else
    $SUDO pg_ctlcluster "$PG_VERSION" main start
  fi
  for _ in $(seq 1 30); do $SUDO -u postgres pg_isready -q && return; sleep 1; done
  echo "PostgreSQL did not become ready" >&2; exit 1
}

start_ollama() {
  if curl -fsS http://127.0.0.1:11434/api/version >/dev/null 2>&1; then return; fi
  if has_systemd && systemctl list-unit-files ollama.service >/dev/null 2>&1; then
    $SUDO systemctl enable --now ollama >/dev/null
  else
    OLLAMA_HOST=127.0.0.1:11434 nohup ollama serve >>"$LOGS/ollama.log" 2>&1 &
  fi
  for _ in $(seq 1 30); do curl -fsS http://127.0.0.1:11434/api/version >/dev/null 2>&1 && return; sleep 1; done
  echo "Ollama did not become ready" >&2; exit 1
}

stop_app() {
  if [ -f "$DATA_DIR/app.pid" ] && kill -0 "$(cat "$DATA_DIR/app.pid")" 2>/dev/null; then
    kill "$(cat "$DATA_DIR/app.pid")" && sleep 2
  fi
  rm -f "$DATA_DIR/app.pid"
}

start_app() {
  stop_app
  cd "$APP_DIR"
  # Bind to all interfaces so the packet.ai NodePort service can reach it.
  NODE_ENV=production nohup npx next start -H 0.0.0.0 -p "$APP_PORT" >>"$LOGS/app.log" 2>&1 &
  echo $! > "$DATA_DIR/app.pid"
  for _ in $(seq 1 60); do
    curl -fsS -o /dev/null "http://127.0.0.1:$APP_PORT/" && { echo "LectureForge is up on port $APP_PORT"; return; }
    sleep 1
  done
  echo "App did not answer on port $APP_PORT — see $LOGS/app.log" >&2; exit 1
}

status() {
  printf 'postgres: '; $SUDO -u postgres pg_isready 2>&1 || true
  printf 'ollama:   '; curl -fsS http://127.0.0.1:11434/api/version 2>/dev/null || echo down; echo
  printf 'app:      '; curl -fsS -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:$APP_PORT/" 2>/dev/null || echo down
}

case "${1:-all}" in
  infra) start_postgres; start_ollama ;;
  app) start_app ;;
  stop-app) stop_app ;;
  status) status ;;
  all) start_postgres; start_ollama; start_app ;;
  *) echo "usage: $0 [all|infra|app|stop-app|status]" >&2; exit 2 ;;
esac
