/*
  # Create style_bibles table

  1. New Tables
    - `style_bibles`
      - `id` (uuid, primary key)
      - `channel_id` (uuid, references channels)
      - `character_name` (text)
      - `appearance_description` (text)
      - `outfit_rules` (text)
      - `background_rules` (text)
      - `color_palette` (text[])
      - `subtitle_font` (text)
      - `subtitle_placement` (text)
      - `cut_duration_rules` (text)
      - `tts_voice_id` (text)
      - `tts_speed` (numeric)
      - `tts_tone` (text)
      - `thumbnail_style` (text)
      - `intro_template` (text)
      - `outro_template` (text)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS
    - Only channel owners can CRUD style bibles
*/

CREATE TABLE IF NOT EXISTS style_bibles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  character_name text NOT NULL DEFAULT '',
  appearance_description text NOT NULL DEFAULT '',
  outfit_rules text NOT NULL DEFAULT '',
  background_rules text NOT NULL DEFAULT '',
  color_palette text[] NOT NULL DEFAULT '{}',
  subtitle_font text NOT NULL DEFAULT 'default',
  subtitle_placement text NOT NULL DEFAULT 'bottom',
  cut_duration_rules text NOT NULL DEFAULT '',
  tts_voice_id text NOT NULL DEFAULT '',
  tts_speed numeric NOT NULL DEFAULT 1.0,
  tts_tone text NOT NULL DEFAULT '',
  thumbnail_style text NOT NULL DEFAULT '',
  intro_template text NOT NULL DEFAULT '',
  outro_template text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE style_bibles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Channel owners can read style bibles"
  ON style_bibles FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM channels
      WHERE channels.id = style_bibles.channel_id
      AND channels.user_id = auth.uid()
    )
  );

CREATE POLICY "Channel owners can insert style bibles"
  ON style_bibles FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM channels
      WHERE channels.id = style_bibles.channel_id
      AND channels.user_id = auth.uid()
    )
  );

CREATE POLICY "Channel owners can update style bibles"
  ON style_bibles FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM channels
      WHERE channels.id = style_bibles.channel_id
      AND channels.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM channels
      WHERE channels.id = style_bibles.channel_id
      AND channels.user_id = auth.uid()
    )
  );

CREATE POLICY "Channel owners can delete style bibles"
  ON style_bibles FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM channels
      WHERE channels.id = style_bibles.channel_id
      AND channels.user_id = auth.uid()
    )
  );
