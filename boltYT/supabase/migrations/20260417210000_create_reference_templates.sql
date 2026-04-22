/*
  # Create reference_templates table

  레퍼런스 영상(YouTube Shorts 등)을 분석하여 추출한 스타일 템플릿.
  새 콘텐츠 생성 시 이 템플릿을 선택하면 자막/BGM/페이싱/음성이 자동 적용됨.

  1. New Tables
    - `reference_templates`
      - id (uuid, pk)
      - channel_id (uuid, fk channels)
      - name (text) — 사용자가 부여한 별칭
      - source_type (text) — 'youtube' | 'file' | 'manual'
      - source_url (text)
      - source_title (text)
      - source_creator (text)
      - thumbnail_url (text)
      - duration_seconds (numeric)

      -- 시각 스타일
      - dominant_colors (jsonb) — ["#1a1a2e", "#e63946"]
      - visual_mood (text) — horror/mystery/news/neutral/warm
      - visual_prompt_template (text) — 이미지 생성 프리셋
      - lighting_style (text) — dark/natural/bright/mixed

      -- 레이아웃
      - subtitle_position (text) — top/center/bottom/dynamic
      - subtitle_size_preset (text) — xs/sm/md/lg/xl
      - subtitle_bg_style (text) — none/pill/block/stroke/glow
      - subtitle_accent_color (text) — hex

      -- 페이싱
      - scene_count (int)
      - avg_scene_duration (numeric)
      - hook_duration (numeric)
      - transition_style (text) — hardcut/crossfade/zoom/mixed
      - pacing_preset (text) — fast/medium/slow

      -- 음성
      - tts_voice_id (text)
      - tts_provider (text) — openai/elevenlabs
      - tts_speed (numeric)
      - tts_tone_keywords (text[])

      -- BGM
      - bgm_mood (text)
      - bgm_keywords (text[])
      - bgm_tempo (text) — slow/mid/fast
      - bgm_reference_url (text)

      -- 스크립트/훅 구조
      - hook_pattern (text) — question/shock/claim/story
      - script_structure (jsonb) — 씬별 역할/길이 패턴

      -- 원본 분석 데이터
      - transcript (text)
      - frame_urls (text[])
      - raw_analysis (jsonb)

      - analysis_status (text) — pending/analyzing/complete/failed
      - analysis_error (text)
      - created_at, updated_at

  2. Security
    - RLS: 채널 소유자만 CRUD
*/

CREATE TABLE IF NOT EXISTS reference_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  source_type text NOT NULL DEFAULT 'youtube',
  source_url text NOT NULL DEFAULT '',
  source_title text NOT NULL DEFAULT '',
  source_creator text NOT NULL DEFAULT '',
  thumbnail_url text NOT NULL DEFAULT '',
  duration_seconds numeric NOT NULL DEFAULT 0,

  dominant_colors jsonb NOT NULL DEFAULT '[]'::jsonb,
  visual_mood text NOT NULL DEFAULT 'neutral',
  visual_prompt_template text NOT NULL DEFAULT '',
  lighting_style text NOT NULL DEFAULT 'natural',

  subtitle_position text NOT NULL DEFAULT 'bottom',
  subtitle_size_preset text NOT NULL DEFAULT 'lg',
  subtitle_bg_style text NOT NULL DEFAULT 'pill',
  subtitle_accent_color text NOT NULL DEFAULT '#FFD700',

  scene_count int NOT NULL DEFAULT 0,
  avg_scene_duration numeric NOT NULL DEFAULT 0,
  hook_duration numeric NOT NULL DEFAULT 0,
  transition_style text NOT NULL DEFAULT 'mixed',
  pacing_preset text NOT NULL DEFAULT 'medium',

  tts_voice_id text NOT NULL DEFAULT '',
  tts_provider text NOT NULL DEFAULT 'openai',
  tts_speed numeric NOT NULL DEFAULT 1.0,
  tts_tone_keywords text[] NOT NULL DEFAULT '{}',

  bgm_mood text NOT NULL DEFAULT '',
  bgm_keywords text[] NOT NULL DEFAULT '{}',
  bgm_tempo text NOT NULL DEFAULT 'mid',
  bgm_reference_url text NOT NULL DEFAULT '',

  hook_pattern text NOT NULL DEFAULT '',
  script_structure jsonb NOT NULL DEFAULT '[]'::jsonb,

  transcript text NOT NULL DEFAULT '',
  frame_urls text[] NOT NULL DEFAULT '{}',
  raw_analysis jsonb NOT NULL DEFAULT '{}'::jsonb,

  analysis_status text NOT NULL DEFAULT 'pending',
  analysis_error text NOT NULL DEFAULT '',

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reference_templates_channel
  ON reference_templates(channel_id);

CREATE INDEX IF NOT EXISTS idx_reference_templates_status
  ON reference_templates(analysis_status);

ALTER TABLE reference_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Channel owners can read reference templates"
  ON reference_templates FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM channels
      WHERE channels.id = reference_templates.channel_id
      AND channels.user_id = auth.uid()
    )
  );

CREATE POLICY "Channel owners can insert reference templates"
  ON reference_templates FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM channels
      WHERE channels.id = reference_templates.channel_id
      AND channels.user_id = auth.uid()
    )
  );

CREATE POLICY "Channel owners can update reference templates"
  ON reference_templates FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM channels
      WHERE channels.id = reference_templates.channel_id
      AND channels.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM channels
      WHERE channels.id = reference_templates.channel_id
      AND channels.user_id = auth.uid()
    )
  );

CREATE POLICY "Channel owners can delete reference templates"
  ON reference_templates FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM channels
      WHERE channels.id = reference_templates.channel_id
      AND channels.user_id = auth.uid()
    )
  );

-- 콘텐츠 생성 시 선택된 템플릿을 scripts 테이블과 연결
ALTER TABLE scripts ADD COLUMN IF NOT EXISTS reference_template_id uuid
  REFERENCES reference_templates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_scripts_reference_template
  ON scripts(reference_template_id);
