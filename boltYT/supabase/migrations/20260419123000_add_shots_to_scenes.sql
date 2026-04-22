/*
  # Add shots to scenes

  컷 편집형 씬을 위해 shot 단위 구성 정보를 저장.
  한 scene 안에서 여러 샷(프레이밍/모션/오버레이)을 순차 재생한다.

  1. Schema
    - scenes.shots (jsonb) — [{id, kind, duration_seconds, crop, motion, ...}, ...]
*/

ALTER TABLE scenes ADD COLUMN IF NOT EXISTS shots jsonb
  NOT NULL DEFAULT '[]'::jsonb;
