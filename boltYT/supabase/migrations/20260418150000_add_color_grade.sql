/*
  # Add color_grade to scenes + reference_templates

  씬별 LUT 색보정 프리셋. reference_template에서 기본값, scene에서 오버라이드.
*/

ALTER TABLE scenes ADD COLUMN IF NOT EXISTS color_grade text
  NOT NULL DEFAULT 'none';

ALTER TABLE reference_templates ADD COLUMN IF NOT EXISTS color_grade text
  NOT NULL DEFAULT 'none';
