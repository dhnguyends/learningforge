#!/usr/bin/env bash
# LearningForge — one-box setup on a packet.ai GPU pod (Ubuntu 22.04 + CUDA).
#
# Installs and configures, idempotently:
#   PostgreSQL 16 + pgvector · Node.js 20 · FFmpeg · yt-dlp · Ollama (+ model)
# then builds the app found in $APP_DIR and writes its production env file.
#
# Usage (on the pod, from the unpacked release):  bash deploy/packet/setup.sh
# Re-running is safe; secrets in $DATA_DIR/secrets.env are generated once.
#
# Environment overrides:
#   DATA_DIR     where data/logs/secrets live (default /home/ubuntu/lectureforge-data;
#                point it at a persistent volume, e.g. /mnt/shared/lectureforge)
#   APP_DIR      unpacked app (default: this repo's root)
#   PUBLIC_URL   e.g. https://203.0.113.10:31234 (sets NEXTAUTH_URL / APP_URL).
#                https:// puts Caddy in front of the app on the exposed pod port
#                (TLS from Caddy's internal CA — bare IPs cannot get public
#                certificates); the app then listens on 127.0.0.1 only.
#   OLLAMA_MODEL default gemma4:latest
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
DATA_DIR="${DATA_DIR:-/home/ubuntu/lectureforge-data}"
OLLAMA_MODEL="${OLLAMA_MODEL:-gemma4:latest}"
OLLAMA_EMBEDDINGS_MODEL="${OLLAMA_EMBEDDINGS_MODEL:-embeddinggemma}"
PUBLIC_URL="${PUBLIC_URL:-http://localhost:3000}"
PG_VERSION=16

log() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"

mkdir -p "$DATA_DIR"/{storage,logs}

# --- System packages ---------------------------------------------------------
log "System packages"
export DEBIAN_FRONTEND=noninteractive
$SUDO apt-get update -y -qq
$SUDO apt-get install -y -qq curl ca-certificates gnupg lsb-release git build-essential ffmpeg python3-pip openssl psmisc >/dev/null

# --- PostgreSQL 16 + pgvector (PGDG repo) -----------------------------------------
if ! command -v "/usr/lib/postgresql/$PG_VERSION/bin/postgres" >/dev/null 2>&1; then
  log "PostgreSQL $PG_VERSION + pgvector"
  $SUDO install -d /usr/share/postgresql-common/pgdg
  $SUDO curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
    | $SUDO tee /etc/apt/sources.list.d/pgdg.list >/dev/null
  $SUDO apt-get update -y -qq
  $SUDO apt-get install -y -qq "postgresql-$PG_VERSION" "postgresql-$PG_VERSION-pgvector" >/dev/null
fi

# --- Node.js 20 -----------------------------------------------------------------
if ! node --version 2>/dev/null | grep -q '^v20\.'; then
  log "Node.js 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO -E bash - >/dev/null
  $SUDO apt-get install -y -qq nodejs >/dev/null
fi

# --- yt-dlp (YouTube import) ------------------------------------------------------
if ! command -v yt-dlp >/dev/null 2>&1; then
  log "yt-dlp"
  $SUDO curl -fsSL -o /usr/local/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp
  $SUDO chmod a+rx /usr/local/bin/yt-dlp
fi

# --- Ollama (local LLM on the GPU) -------------------------------------------------
if ! command -v ollama >/dev/null 2>&1; then
  log "Ollama"
  curl -fsSL https://ollama.com/install.sh | sh
fi

# --- HTTPS front (Caddy) when PUBLIC_URL is https:// -----------------------------------
PUBLIC_SCHEME="${PUBLIC_URL%%://*}"
PUBLIC_HOST="$(echo "$PUBLIC_URL" | sed -E 's#^[a-z]+://##; s#[:/].*$##')"
PROXY_PORT=3000          # the pod port the packet.ai service exposes
if [ "$PUBLIC_SCHEME" = "https" ]; then
  if ! command -v caddy >/dev/null 2>&1; then
    log "Caddy (TLS reverse proxy)"
    $SUDO apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https >/dev/null
    curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | $SUDO gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | $SUDO tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
    $SUDO apt-get update -y -qq
    $SUDO apt-get install -y -qq caddy >/dev/null
  fi
  log "Writing /etc/caddy/Caddyfile for https://$PUBLIC_HOST"
  # Browsers send no SNI for IP addresses: default_sni picks the IP certificate.
  # http_redirect turns plain-HTTP requests arriving on the TLS port into
  # redirects to https:// on the same (public) host:port.
  $SUDO tee /etc/caddy/Caddyfile >/dev/null <<EOF
{
	default_sni $PUBLIC_HOST
	skip_install_trust
	servers {
		listener_wrappers {
			http_redirect
			tls
		}
	}
}

https://$PUBLIC_HOST:$PROXY_PORT {
	bind 0.0.0.0
	tls internal
	encode zstd gzip
	header -Server
	reverse_proxy 127.0.0.1:3001
}
EOF
  $SUDO caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
  RUNTIME="TLS_PROXY=1
APP_BIND=127.0.0.1
APP_PORT=3001
PROXY_PORT=$PROXY_PORT
PUBLIC_HOST=$PUBLIC_HOST"
else
  RUNTIME="TLS_PROXY=0
APP_BIND=0.0.0.0
APP_PORT=3000"
fi
printf '%s\n' "$RUNTIME" > "$DATA_DIR/runtime.env"

# --- Secrets (generated once, kept on the data dir) -----------------------------------
SECRETS="$DATA_DIR/secrets.env"
if [ ! -f "$SECRETS" ]; then
  log "Generating secrets"
  umask 077
  cat > "$SECRETS" <<EOF
NEXTAUTH_SECRET="$(openssl rand -base64 48 | tr -d '\n')"
PG_PASSWORD="$(openssl rand -hex 24)"
EOF
fi
# Site access key: keep the one in secrets.env; add one (from $LECTURE_ACCESS_KEY or
# random) if this pod predates the access gate.
if ! grep -q '^LECTURE_ACCESS_KEY=' "$SECRETS"; then
  umask 077
  echo "LECTURE_ACCESS_KEY=\"${LECTURE_ACCESS_KEY:-$(openssl rand -base64 18 | tr -d '\n/+=')}\"" >> "$SECRETS"
fi
# shellcheck disable=SC1090
. "$SECRETS"

# --- Services up (works with or without systemd) ----------------------------------------
bash "$APP_DIR/deploy/packet/start.sh" infra

# --- Database ------------------------------------------------------------------------------
log "Database"
$SUDO -u postgres psql -v ON_ERROR_STOP=1 -q <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'lectureforge') THEN
    CREATE ROLE lectureforge LOGIN PASSWORD '${PG_PASSWORD}';
  ELSE
    ALTER ROLE lectureforge PASSWORD '${PG_PASSWORD}';
  END IF;
END \$\$;
SQL
$SUDO -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='lectureforge'" | grep -q 1 \
  || $SUDO -u postgres createdb -O lectureforge lectureforge
$SUDO -u postgres psql -q -d lectureforge -c "CREATE EXTENSION IF NOT EXISTS vector;"

# --- Model ----------------------------------------------------------------------------------
log "Pulling $OLLAMA_MODEL (first time: several GB) and $OLLAMA_EMBEDDINGS_MODEL"
ollama pull "$OLLAMA_MODEL"
ollama pull "$OLLAMA_EMBEDDINGS_MODEL"

# --- App env ----------------------------------------------------------------------------------
log "Writing $APP_DIR/.env.production.local"
umask 077
cat > "$APP_DIR/.env.production.local" <<EOF
# Generated by deploy/packet/setup.sh — re-run setup to change.
NODE_ENV=production
APP_URL="${PUBLIC_URL}"
NEXTAUTH_URL="${PUBLIC_URL}"
NEXTAUTH_SECRET="${NEXTAUTH_SECRET}"
# Invite-only gate: visitors enter this once at /access (read it from $DATA_DIR/secrets.env).
LECTURE_ACCESS_KEY="${LECTURE_ACCESS_KEY}"
DATABASE_URL="postgresql://lectureforge:${PG_PASSWORD}@127.0.0.1:5432/lectureforge?schema=public"

# Single box: jobs run in the web process, files on local disk ($DATA_DIR/storage).
QUEUE_DRIVER=inline
STORAGE_DRIVER=local

AI_PROVIDER=local
LOCAL_AI_BASE_URL=http://127.0.0.1:11434
LOCAL_AI_MODEL=${OLLAMA_MODEL}
LOCAL_AI_THINK=false
LOCAL_AI_TIMEOUT_MS=300000
LOCAL_AI_MAX_TOKENS=4096

# Semantic, multilingual embeddings for RAG (vectors stored in pgvector).
EMBEDDINGS_PROVIDER=ollama
OLLAMA_EMBEDDINGS_MODEL=${OLLAMA_EMBEDDINGS_MODEL}

# Not configured yet: these stay on the offline stand-ins.
TRANSCRIPTION_PROVIDER=mock
TTS_PROVIDER=mock
GENERATION_RATE_LIMIT_PER_HOUR=30
EOF
# Cloud keys (e.g. ZAI_API_KEY, GEMINI_API_KEY) live only on the pod, in
# $DATA_DIR/extra.env, and survive redeploys; later lines override the above.
if [ -s "$DATA_DIR/extra.env" ]; then
  { echo; echo "# From $DATA_DIR/extra.env"; cat "$DATA_DIR/extra.env"; } >> "$APP_DIR/.env.production.local"
fi
# Prisma CLI / scripts read .env, not .env.production.local.
ln -sf .env.production.local "$APP_DIR/.env"

# Local storage driver writes to $APP_DIR/.data/storage — keep it on the data dir.
mkdir -p "$APP_DIR/.data"
if [ ! -L "$APP_DIR/.data/storage" ]; then
  rm -rf "$APP_DIR/.data/storage"
  ln -s "$DATA_DIR/storage" "$APP_DIR/.data/storage"
fi

# --- Build -----------------------------------------------------------------------------------
log "Installing dependencies and building"
cd "$APP_DIR"
npm ci --no-audit --no-fund
# PolyLingue browser notifications: a VAPID key pair made once, kept with the secrets.
if ! grep -q '^VAPID_PUBLIC_KEY=' "$SECRETS"; then
  log "Generating the VAPID keys for browser notifications"
  umask 077
  node -e 'const k = require("web-push").generateVAPIDKeys(); console.log(`VAPID_PUBLIC_KEY="${k.publicKey}"\nVAPID_PRIVATE_KEY="${k.privateKey}"`)' >> "$SECRETS"
fi
# shellcheck disable=SC1090
. "$SECRETS"
{
  echo
  echo "# PolyLingue browser notifications (keys from $SECRETS)"
  echo "VAPID_PUBLIC_KEY=\"$VAPID_PUBLIC_KEY\""
  echo "VAPID_PRIVATE_KEY=\"$VAPID_PRIVATE_KEY\""
  echo "VAPID_SUBJECT=\"${VAPID_SUBJECT:-mailto:admin@learningforge.local}\""
} >> "$APP_DIR/.env.production.local"
npm run db:setup
# Bring every chunk's vector onto the configured embeddings model (no-op when current).
npx tsx scripts/reembed.ts
NODE_ENV=production npm run build

log "Setup complete. Start the app with: bash deploy/packet/start.sh app"
