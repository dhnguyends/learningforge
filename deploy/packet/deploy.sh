#!/usr/bin/env bash
# Ship the committed code to a packet.ai pod and (re)build + restart it.
# Run from a clean checkout on your machine (Git Bash on Windows works):
#
#   PACKET_HOST=50.35.188.68 PACKET_PORT=30618 \
#   PUBLIC_URL=http://50.35.188.68:31234 \
#   bash deploy/packet/deploy.sh [git-ref]
#
# Only committed files are shipped (git archive) — .env and local data never
# leave your machine. SSH_KEY defaults to ~/.ssh/packet_lectureforge.
set -euo pipefail

REF="${1:-HEAD}"
: "${PACKET_HOST:?set PACKET_HOST (pod IP)}"
: "${PACKET_PORT:?set PACKET_PORT (pod SSH port)}"
PACKET_USER="${PACKET_USER:-ubuntu}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/packet_lectureforge}"
REMOTE_DIR="${REMOTE_DIR:-/home/ubuntu/lectureforge}"
PUBLIC_URL="${PUBLIC_URL:-http://${PACKET_HOST}:3000}"
DATA_DIR="${DATA_DIR:-/home/ubuntu/lectureforge-data}"

SSH=(ssh -i "$SSH_KEY" -o IdentitiesOnly=yes -o BatchMode=yes -p "$PACKET_PORT" "$PACKET_USER@$PACKET_HOST")

if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree has uncommitted changes — only committed code ($REF) will be deployed." >&2
fi

echo "==> Shipping $(git rev-parse --short "$REF") to $PACKET_USER@$PACKET_HOST:$REMOTE_DIR"
git archive --format=tar "$REF" | "${SSH[@]}" "mkdir -p '$REMOTE_DIR' && tar -x -C '$REMOTE_DIR' && echo '$(git rev-parse "$REF")' > '$REMOTE_DIR/REVISION'"

echo "==> Setup + build on the pod"
"${SSH[@]}" "cd '$REMOTE_DIR' && DATA_DIR='$DATA_DIR' PUBLIC_URL='$PUBLIC_URL' bash deploy/packet/setup.sh"

echo "==> Starting"
"${SSH[@]}" "cd '$REMOTE_DIR' && DATA_DIR='$DATA_DIR' bash deploy/packet/start.sh"
echo "Deployed. Public URL: $PUBLIC_URL"
