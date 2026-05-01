/*
  # Add scene directives columns

  planSceneDirectives 결과(촬영 지시 5종)를 영속화하여 페이지 리로드 / AI 영상
  생성 시 재계산 비용을 절약. 기본값 NULL — 미계산 씬은 비어있음.

  - shot_type: wide / medium / close_up / extreme_close / aerial
  - camera_motion: static / slow_pan / zoom_in / zoom_out / handheld / tilt_up / tilt_down
  - lighting_style: dark / natural / bright / mixed (referenceTemplate 와 동일)
  - bgm_mood: tension / mysterious / sad / neutral / hopeful / horror
  - pacing: slow / normal / fast
*/

ALTER TABLE scenes ADD COLUMN IF NOT EXISTS shot_type text;
ALTER TABLE scenes ADD COLUMN IF NOT EXISTS camera_motion text;
ALTER TABLE scenes ADD COLUMN IF NOT EXISTS lighting_style text;
ALTER TABLE scenes ADD COLUMN IF NOT EXISTS scene_bgm_mood text;
ALTER TABLE scenes ADD COLUMN IF NOT EXISTS pacing text;
