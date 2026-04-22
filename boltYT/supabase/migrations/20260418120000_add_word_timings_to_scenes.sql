/*
  # Add word_timings to scenes

  Whisper에서 추출한 단어별 타이밍을 저장.
  자막 sync 정확도를 글자수 추정 → 실제 발화 기반으로 전환.

  1. Schema
    - scenes.word_timings (jsonb) — [{"word": "안녕", "startFrame": 0, "endFrame": 12}, ...]
*/

ALTER TABLE scenes ADD COLUMN IF NOT EXISTS word_timings jsonb
  NOT NULL DEFAULT '[]'::jsonb;
