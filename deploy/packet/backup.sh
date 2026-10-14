#!/usr/bin/env bash
# Back up / restore a LearningForge trial pod that has NO persistent storage.
# Everything on such a pod disappears when it stops — run `backup` first.
#
#   PACKET_HOST=… PACKET_PORT=… bash deploy/packet/backup.sh backup  [dir]
#   PACKET_HOST=… PACKET_PORT=… bash deploy/packet/backup.sh restore <dir>/<stamp>
#
# A backup is a folder with:
#   db.dump        pg_dump custom format of the lectureforge database
#   storage.tar.gz uploaded files + derived audio (the local storage driver)
#   secrets.env    NEXTAUTH_SECRET + DB password, so sessions/tickets stay valid
#                  (keep this folder private — it holds credentials)
#
# Restore after `deploy.sh` has set up a fresh pod: it stops the app, replaces
# the database and files, reinstates the secrets, and restarts.
set -euo pipefail

: "${PACKET_HOST:?set PACKET_HOST (pod IP)}"
: "${PACKET_PORT:?set PACKET_PORT (pod SSH port)}"
PACKET_USER="${PACKET_USER:-ubuntu}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/packet_lectureforge}"
REMOTE_DIR="${REMOTE_DIR:-/home/ubuntu/lectureforge}"
DATA_DIR="${DATA_DIR:-/home/ubuntu/lectureforge-data}"
SSH=(ssh -i "$SSH_KEY" -o IdentitiesOnly=yes -o BatchMode=yes -p "$PACKET_PORT" "$PACKET_USER@$PACKET_HOST")

case "${1:-}" in
  backup)
    out="${2:-./backups}/$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$out"
    chmod 700 "$out"
    echo "==> Database"
    "${SSH[@]}" "sudo -u postgres pg_dump -Fc lectureforge" > "$out/db.dump"
    echo "==> Files"
    "${SSH[@]}" "tar -C '$DATA_DIR' -czf - storage" > "$out/storage.tar.gz"
    echo "==> Secrets"
    "${SSH[@]}" "cat '$DATA_DIR/secrets.env'" > "$out/secrets.env"
    chmod 600 "$out/secrets.env"
    ls -la "$out"
    echo "Backup written to $out"
    ;;
  restore)
    src="${2:?usage: backup.sh restore <backup-folder>}"
    for f in db.dump storage.tar.gz secrets.env; do [ -s "$src/$f" ] || { echo "missing $src/$f" >&2; exit 1; }; done
    echo "==> Stopping app"
    "${SSH[@]}" "cd '$REMOTE_DIR' && DATA_DIR='$DATA_DIR' bash deploy/packet/start.sh stop-app"
    echo "==> Secrets"
    "${SSH[@]}" "umask 077 && cat > '$DATA_DIR/secrets.env'" < "$src/secrets.env"
    echo "==> Files"
    "${SSH[@]}" "rm -rf '$DATA_DIR/storage' && tar -C '$DATA_DIR' -xzf -" < "$src/storage.tar.gz"
    echo "==> Database"
    "${SSH[@]}" "sudo -u postgres pg_restore --clean --if-exists --no-owner --role=lectureforge -d lectureforge" < "$src/db.dump"
    echo "==> Re-applying env with restored secrets and restarting"
    "${SSH[@]}" "cd '$REMOTE_DIR' && . '$DATA_DIR/secrets.env' && sudo -u postgres psql -q -c \"ALTER ROLE lectureforge PASSWORD '\$PG_PASSWORD'\" \
      && sed -i \"s|^NEXTAUTH_SECRET=.*|NEXTAUTH_SECRET=\\\"\$NEXTAUTH_SECRET\\\"|; s|^DATABASE_URL=.*|DATABASE_URL=\\\"postgresql://lectureforge:\$PG_PASSWORD@127.0.0.1:5432/lectureforge?schema=public\\\"|\" .env.production.local \
      && DATA_DIR='$DATA_DIR' bash deploy/packet/start.sh app"
    echo "Restore complete."
    ;;
  *)
    echo "usage: $0 backup [dir] | restore <backup-folder>" >&2
    exit 2
    ;;
esac
