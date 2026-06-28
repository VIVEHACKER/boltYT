#!/usr/bin/env bash
# 경제 뉴스 해설 채널 무인 양산 래퍼 (cron/launchd).
# 매 실행마다 RSS 최신 "미사용" 기사 1건으로 영상 1편. 기사 dedup 은 make-economy(economy-used.json)가 처리 → 멱등.
# 설치 예 (매일 07:00, 10분 영상):
#   crontab -e
#   0 7 * * * /Users/jjuni/bolt/boltYT/scripts/economy-cron.sh >> /tmp/economy-cron.log 2>&1
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# 동시 실행 방지 락(mkdir 원자적, stale 탈취).
LOCK="${TMPDIR:-/tmp}/economy-cron.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -f "$LOCK/pid" ] && kill -0 "$(cat "$LOCK/pid" 2>/dev/null)" 2>/dev/null; then
    echo "[$(date '+%F %T')] ⏭ 이전 실행 중 — 건너뜀"; exit 0
  fi
  echo "[$(date '+%F %T')] ℹ stale lock 정리"; rm -rf "$LOCK"; mkdir "$LOCK" || { echo "lock 실패"; exit 1; }
fi
echo $$ >"$LOCK/pid"
trap 'rm -rf "$LOCK"' EXIT

MINUTES="${ECONOMY_MINUTES:-10}"
CHANNEL="${ECONOMY_CHANNEL:-경제 한입}"
COMFY_URL="${COMFY_URL:-http://localhost:8188}"
PROXY_URL="${API_PROXY_URL:-http://localhost:3459}"
# 화질/속도 기본값 — 라이브 검증: DreamShaper XL Turbo + fast 프리셋(euler 8스텝 ≈ 27s/장).
# base SDXL 30스텝보다 빠르고 화질↑. 모델 미설치 머신이면 COMFY_CKPT 를 설치된 체크포인트로 덮어쓸 것.
export COMFY_CKPT="${COMFY_CKPT:-DreamShaperXL_Turbo_V2-SFW.safetensors}"
export COMFY_PRESET="${COMFY_PRESET:-fast}"

echo "[$(date '+%F %T')] economy-cron 시작 (minutes=$MINUTES)"

# ComfyUI 는 자동 기동 안 함(GPU 메모리 관리) — 없으면 중단.
if ! curl -sf -m 5 "$COMFY_URL/system_stats" >/dev/null 2>&1; then
  echo "❌ ComfyUI($COMFY_URL) 응답 없음 — 먼저 켜야 함. 중단."; exit 2
fi
# api-proxy 없으면 백그라운드 기동(.env 의 LLM_BACKEND/키 로드).
if ! curl -sf -m 5 "$PROXY_URL/health" >/dev/null 2>&1; then
  echo "ℹ api-proxy 미가동 → 백그라운드 기동"
  nohup npx tsx server/api-proxy.ts >/tmp/economy-proxy.log 2>&1 &
  for _ in $(seq 1 20); do curl -sf -m 3 "$PROXY_URL/health" >/dev/null 2>&1 && break; sleep 1; done
fi

npm run vlog:economy -- --minutes "$MINUTES" --channel "$CHANNEL" "$@"
echo "[$(date '+%F %T')] economy-cron 종료"
