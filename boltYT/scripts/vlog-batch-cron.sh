#!/usr/bin/env bash
# vlog:batch 무인 양산 래퍼 (cron/launchd 용).
# - 멱등: 이미 만든 토픽은 레저로 건너뜀 → 매일 호출해도 안전.
# - api-proxy(3459)가 죽어 있으면 백그라운드로 띄움(ComfyUI 8188 은 자동 기동 안 함 — 수동/별도 관리).
# 설치 예 (매일 03:00, 하루 2편 / 백로그 10편 유지):
#   crontab -e
#   0 3 * * * /Users/jjuni/bolt/boltYT/scripts/vlog-batch-cron.sh >> /tmp/vlog-batch-cron.log 2>&1
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# 동시 실행 방지 락(Codex P2): 이전 배치가 아직 렌더 중인데 다음 cron 이 뜨면 같은 잡 중복+GPU 경합.
# mkdir 은 원자적이라 프로세스 간 락으로 안전. 보유 프로세스가 죽었으면 stale 로 보고 탈취(무인 양산 영속).
LOCK="${TMPDIR:-/tmp}/vlog-batch.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -f "$LOCK/pid" ] && kill -0 "$(cat "$LOCK/pid" 2>/dev/null)" 2>/dev/null; then
    echo "[$(date '+%F %T')] ⏭ 이전 배치 실행 중(lock) — 이번 cron 건너뜀"
    exit 0
  fi
  echo "[$(date '+%F %T')] ℹ stale lock 정리"
  rm -rf "$LOCK"
  mkdir "$LOCK" || { echo "lock 획득 실패"; exit 1; }
fi
echo $$ >"$LOCK/pid"
trap 'rm -rf "$LOCK"' EXIT

MAX="${VLOG_BATCH_MAX:-2}"
TARGET="${VLOG_BATCH_TARGET:-10}"
COMFY_URL="${COMFY_URL:-http://localhost:8188}"
PROXY_URL="${API_PROXY_URL:-http://localhost:3459}"

echo "[$(date '+%F %T')] vlog-batch-cron 시작 (max=$MAX target=$TARGET)"

# ComfyUI 는 자동 기동하지 않음(GPU 메모리 관리 필요) — 없으면 중단.
if ! curl -sf -m 5 "$COMFY_URL/system_stats" >/dev/null 2>&1; then
  echo "❌ ComfyUI($COMFY_URL) 응답 없음 — 먼저 켜야 함. 중단."
  exit 2
fi

# api-proxy 없으면 백그라운드 기동(.env 의 LLM_BACKEND/키 로드).
if ! curl -sf -m 5 "$PROXY_URL/health" >/dev/null 2>&1; then
  echo "ℹ api-proxy 미가동 → 백그라운드 기동"
  nohup npx tsx server/api-proxy.ts >/tmp/vlog-batch-proxy.log 2>&1 &
  for _ in $(seq 1 20); do
    curl -sf -m 3 "$PROXY_URL/health" >/dev/null 2>&1 && break
    sleep 1
  done
fi

npm run vlog:batch -- --max "$MAX" --target "$TARGET" "$@"
echo "[$(date '+%F %T')] vlog-batch-cron 종료"
