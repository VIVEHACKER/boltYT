/*
  # Add BGM analysis (BPM + beats) to reference_templates

  실측 BPM + 비트 타임스탬프 저장 → 씬 컷을 실제 비트에 정렬 가능.

  1. Schema
    - reference_templates.bgm_bpm (numeric) — 실측 BPM (0 = 미분석)
    - reference_templates.bgm_beats (jsonb) — 비트 타임스탬프 배열 (초)
    - reference_templates.bgm_bpm_confidence (numeric) — 0-1
*/

ALTER TABLE reference_templates ADD COLUMN IF NOT EXISTS bgm_bpm numeric
  NOT NULL DEFAULT 0;
ALTER TABLE reference_templates ADD COLUMN IF NOT EXISTS bgm_beats jsonb
  NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE reference_templates ADD COLUMN IF NOT EXISTS bgm_bpm_confidence numeric
  NOT NULL DEFAULT 0;
