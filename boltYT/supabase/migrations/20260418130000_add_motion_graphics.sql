/*
  # Add motion_graphics to scenes

  애니메이션 모션 그래픽 레이어 (숫자 카운터, 로워서드, 화살표 등).
  프로 쇼츠의 필수 시각 요소.

  1. Schema
    - scenes.motion_graphics (jsonb) — [{type, params, startFrame, duration}, ...]
*/

ALTER TABLE scenes ADD COLUMN IF NOT EXISTS motion_graphics jsonb
  NOT NULL DEFAULT '[]'::jsonb;
