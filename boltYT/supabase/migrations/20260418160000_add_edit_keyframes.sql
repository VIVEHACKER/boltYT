/*
  # Add edit_keyframes + start_frame to scenes

  프레임 정확 타임라인 에디터용:
  - start_frame: 전역 타임라인 위치 (씬 순서만 쓰던 것을 명시적 프레임으로)
  - edit_keyframes: scale/opacity/position 키프레임 애니메이션 정의
*/

ALTER TABLE scenes ADD COLUMN IF NOT EXISTS start_frame int NOT NULL DEFAULT 0;
ALTER TABLE scenes ADD COLUMN IF NOT EXISTS edit_keyframes jsonb
  NOT NULL DEFAULT '{}'::jsonb;
