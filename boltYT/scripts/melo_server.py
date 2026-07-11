#!/usr/bin/env python3
"""MeloTTS 한국어 로컬 TTS 서버 — 모델을 1회 로드해 두고 POST /tts 로 양산(매 호출 모델 재로드 회피).

실행: ~/melo-venv/bin/python scripts/melo_server.py   (setup-melo.sh 로 구축한 venv)
환경: MELO_PORT(기본 3461) · MELO_LANG(기본 KR) · MELO_DEVICE(기본 cpu) · MELO_SPEAKER(기본 첫 화자)
API:  GET /health → {"ok":true} · POST /tts {"text","speed"} → audio/mpeg(mp3 바이트)
속도(TTS_SPEED)는 호출측 공용 atempo 경로에서 일괄 적용하므로 기본 speed=1.0(정속)으로 둔다.
"""

import json
import os
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("MELO_PORT", "3461"))
LANG = os.environ.get("MELO_LANG", "KR")
DEVICE = os.environ.get("MELO_DEVICE", "cpu")

print(f"[melo-server] loading MeloTTS lang={LANG} device={DEVICE} ...", flush=True)
from melo.api import TTS  # noqa: E402
import torch  # noqa: E402  (melo 의존성 — CPU 스레드/추론 메모리 제어용)

# CPU 스레드 상한(선택). 병렬 워커가 코어를 과점해 스케줄링/스레드 스택 RAM 이 몰리는 것을 막는다.
# 미설정 시 torch 기본값 유지 → 기존 동작 무변화.
_threads = os.environ.get("MELO_THREADS", "")
if _threads.isdigit() and int(_threads) > 0:
    torch.set_num_threads(int(_threads))
    print(f"[melo-server] torch threads capped at {_threads}", flush=True)

_tts = TTS(language=LANG, device=DEVICE)
_spk = dict(_tts.hps.data.spk2id)  # HParams → dict(.get 없음)
_sid = _spk.get(os.environ.get("MELO_SPEAKER", ""), next(iter(_spk.values())))
# 동시 합성 직렬화 락 — ThreadingHTTPServer 로 여러 /tts 가 동시에 와도 모델 활성화 메모리를
# 1회분으로 억제한다(피크 RAM 을 "몰아서" 쓰지 않게). ffmpeg 인코딩은 락 밖이라 병렬 유지.
_synth_lock = threading.Lock()
print(f"[melo-server] ready :{PORT} speakers={_spk}", flush=True)


def _synth_mp3(text: str, speed: float) -> bytes:
    with tempfile.TemporaryDirectory() as d:
        wav = os.path.join(d, "o.wav")
        mp3 = os.path.join(d, "o.mp3")
        # 직렬화 + inference_mode: 동시 요청이 와도 모델 활성화 RAM 을 1회분으로 억제하고
        # autograd 부기 메모리를 제거한다(합성은 추론 전용이라 그래프 불필요).
        with _synth_lock, torch.inference_mode():
            _tts.tts_to_file(text, _sid, wav, speed=speed)
        subprocess.run(
            ["ffmpeg", "-y", "-i", wav, "-c:a", "libmp3lame", "-q:a", "2", mp3],
            check=True,
            capture_output=True,
        )
        with open(mp3, "rb") as f:
            return f.read()


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="application/json"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._send(200, b'{"ok":true,"service":"melo-tts"}')
        else:
            self._send(404, b'{"error":"not found"}')

    def do_POST(self):
        try:
            n = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(n) or b"{}")
            text = (body.get("text") or "").strip()
            speed = float(body.get("speed", 1.0))
            if not text:
                self._send(400, b'{"error":"empty text"}')
                return
            self._send(200, _synth_mp3(text, speed), "audio/mpeg")
        except Exception as e:  # noqa: BLE001
            self._send(500, json.dumps({"error": str(e)}).encode())

    def log_message(self, *a):  # 조용히
        return


if __name__ == "__main__":
    try:
        ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
    except KeyboardInterrupt:
        sys.exit(0)
