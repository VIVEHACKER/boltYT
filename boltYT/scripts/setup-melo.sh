#!/usr/bin/env bash
# MeloTTS 한국어 로컬 TTS 재현 설치 (Apple Silicon Mac, 완전 로컬·무료·MIT).
# edge-tts(온라인 의존)를 대체하는 로컬 한국어 TTS. ComfyUI venv 오염 방지 위해 별도 ~/melo-venv 사용.
#
# Mac 의존성 지옥 우회 순서(검증됨):
#  - python 3.11 (3.12+ 는 tokenizers prebuilt 휠 없어 빌드 실패)
#  - coverage>=7.4 (numba 가 coverage.types 요구)
#  - python-mecab-ko (한국어 g2pkk pos) — mecab-python3 는 네임스페이스 충돌이라 제거
#  - 스텁 MeCab + fugashi/unidic-lite (japanese.py eager import 만 통과, 한국어엔 미사용)
set -euo pipefail
log(){ echo "[setup-melo] $*"; }

PY311="$(brew --prefix 2>/dev/null)/bin/python3.11"
if [ ! -x "$PY311" ]; then
  log "python@3.11 설치"; brew install python@3.11
  PY311="$(brew --prefix)/bin/python3.11"
fi
log "python = $("$PY311" --version)"

log "venv 재구성: ~/melo-venv"
rm -rf ~/melo-venv
"$PY311" -m venv ~/melo-venv
# shellcheck disable=SC1090
source ~/melo-venv/bin/activate
pip install -q -U pip wheel setuptools

log "MeloTTS 설치(torch 포함, 수 분 소요)"
pip install -q "git+https://github.com/myshell-ai/MeloTTS.git"

log "충돌 패키지 정리 + 한국어/우회 의존성"
pip uninstall -y mecab-python3 unidic >/dev/null 2>&1 || true
pip install -q -U "coverage>=7.4"
pip install -q python-mecab-ko python-mecab-ko-dic g2pkk
pip install -q fugashi unidic-lite

SP="$(python -c 'import site;print(site.getsitepackages()[0])')"

log "스텁 MeCab 생성(japanese.py 의 import MeCab + Tagger() 통과용, 한국어엔 미사용)"
cat > "$SP/MeCab.py" <<'PYEOF'
class Tagger:
    def __init__(self, *a, **k):
        pass
    def parse(self, *a, **k):
        return ""
    def parseToNode(self, *a, **k):
        return None
PYEOF

log "cleaner.py 일본어 직접 의존 제거(한국어만 사용)"
CL="$SP/melo/text/cleaner.py"
sed -i '' 's/from \. import chinese, japanese, english, chinese_mix, korean, french, spanish/from . import chinese, english, chinese_mix, korean, french, spanish/' "$CL" || true
sed -i '' 's/"JP": japanese, //' "$CL" || true

log "한국어 합성 검증"
TOKENIZERS_PARALLELISM=false python - <<'PY'
from melo.api import TTS
t = TTS(language='KR', device='cpu')
sid = next(iter(t.hps.data.spk2id.values()))
t.tts_to_file("설치 검증 완료. 한국어 음성 합성이 정상 작동합니다.", sid, "/tmp/melo_setup_ok.wav", speed=1.0)
import os
assert os.path.getsize("/tmp/melo_setup_ok.wav") > 1000
print("[setup-melo] OK — /tmp/melo_setup_ok.wav")
PY
log "완료. 서버 실행: ~/melo-venv/bin/python scripts/melo_server.py (포트 3461)"
