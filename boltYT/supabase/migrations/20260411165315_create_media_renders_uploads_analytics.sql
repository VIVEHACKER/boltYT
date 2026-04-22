/*
  # Create media assets, renders, approvals, uploads, and analytics tables

  1. New Tables
    - `media_assets` - generated media files per scene
      - `id`, `scene_id`, `type`, `storage_path`, `generation_params`, `status`, `created_at`
    - `renders` - final rendered video files
      - `id`, `script_id`, `format`, `aspect_ratio`, `storage_path`, `duration_seconds`, `status`, `qc_result_json`, `created_at`
    - `approvals` - approval/rejection records
      - `id`, `render_id`, `status`, `rejection_reason`, `rejection_scope`, `reviewed_at`
    - `uploads` - YouTube upload records
      - `id`, `render_id`, `youtube_video_id`, `title`, `description`, `tags`, `thumbnail_path`, `playlist`, `scheduled_at`, `published_at`, `status`
    - `analytics` - performance data per upload
      - `id`, `upload_id`, `views`, `ctr`, `avg_watch_duration`, `likes`, `comments`, `subscribers_gained`, `fetched_at`

  2. Security
    - RLS on all tables, scoped to channel owner via join chain
*/

CREATE TABLE IF NOT EXISTS media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scene_id uuid NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'image',
  storage_path text NOT NULL DEFAULT '',
  generation_params jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE media_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Channel owners can read media assets"
  ON media_assets FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM scenes JOIN scripts ON scripts.id = scenes.script_id JOIN briefs ON briefs.id = scripts.brief_id JOIN topics ON topics.id = briefs.topic_id JOIN channels ON channels.id = topics.channel_id
    WHERE scenes.id = media_assets.scene_id AND channels.user_id = auth.uid()
  ));

CREATE POLICY "Channel owners can insert media assets"
  ON media_assets FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM scenes JOIN scripts ON scripts.id = scenes.script_id JOIN briefs ON briefs.id = scripts.brief_id JOIN topics ON topics.id = briefs.topic_id JOIN channels ON channels.id = topics.channel_id
    WHERE scenes.id = media_assets.scene_id AND channels.user_id = auth.uid()
  ));

CREATE POLICY "Channel owners can update media assets"
  ON media_assets FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM scenes JOIN scripts ON scripts.id = scenes.script_id JOIN briefs ON briefs.id = scripts.brief_id JOIN topics ON topics.id = briefs.topic_id JOIN channels ON channels.id = topics.channel_id
    WHERE scenes.id = media_assets.scene_id AND channels.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM scenes JOIN scripts ON scripts.id = scenes.script_id JOIN briefs ON briefs.id = scripts.brief_id JOIN topics ON topics.id = briefs.topic_id JOIN channels ON channels.id = topics.channel_id
    WHERE scenes.id = media_assets.scene_id AND channels.user_id = auth.uid()
  ));

CREATE POLICY "Channel owners can delete media assets"
  ON media_assets FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM scenes JOIN scripts ON scripts.id = scenes.script_id JOIN briefs ON briefs.id = scripts.brief_id JOIN topics ON topics.id = briefs.topic_id JOIN channels ON channels.id = topics.channel_id
    WHERE scenes.id = media_assets.scene_id AND channels.user_id = auth.uid()
  ));

CREATE TABLE IF NOT EXISTS renders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  script_id uuid NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
  format text NOT NULL DEFAULT 'shorts',
  aspect_ratio text NOT NULL DEFAULT '9:16',
  storage_path text NOT NULL DEFAULT '',
  duration_seconds numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  qc_result_json jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE renders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Channel owners can read renders"
  ON renders FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM scripts JOIN briefs ON briefs.id = scripts.brief_id JOIN topics ON topics.id = briefs.topic_id JOIN channels ON channels.id = topics.channel_id
    WHERE scripts.id = renders.script_id AND channels.user_id = auth.uid()
  ));

CREATE POLICY "Channel owners can insert renders"
  ON renders FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM scripts JOIN briefs ON briefs.id = scripts.brief_id JOIN topics ON topics.id = briefs.topic_id JOIN channels ON channels.id = topics.channel_id
    WHERE scripts.id = renders.script_id AND channels.user_id = auth.uid()
  ));

CREATE POLICY "Channel owners can update renders"
  ON renders FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM scripts JOIN briefs ON briefs.id = scripts.brief_id JOIN topics ON topics.id = briefs.topic_id JOIN channels ON channels.id = topics.channel_id
    WHERE scripts.id = renders.script_id AND channels.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM scripts JOIN briefs ON briefs.id = scripts.brief_id JOIN topics ON topics.id = briefs.topic_id JOIN channels ON channels.id = topics.channel_id
    WHERE scripts.id = renders.script_id AND channels.user_id = auth.uid()
  ));

CREATE POLICY "Channel owners can delete renders"
  ON renders FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM scripts JOIN briefs ON briefs.id = scripts.brief_id JOIN topics ON topics.id = briefs.topic_id JOIN channels ON channels.id = topics.channel_id
    WHERE scripts.id = renders.script_id AND channels.user_id = auth.uid()
  ));

CREATE TABLE IF NOT EXISTS approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  render_id uuid NOT NULL REFERENCES renders(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  rejection_reason text NOT NULL DEFAULT '',
  rejection_scope text NOT NULL DEFAULT '',
  reviewed_at timestamptz
);

ALTER TABLE approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Channel owners can read approvals"
  ON approvals FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM renders JOIN scripts ON scripts.id = renders.script_id JOIN briefs ON briefs.id = scripts.brief_id JOIN topics ON topics.id = briefs.topic_id JOIN channels ON channels.id = topics.channel_id
    WHERE renders.id = approvals.render_id AND channels.user_id = auth.uid()
  ));

CREATE POLICY "Channel owners can insert approvals"
  ON approvals FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM renders JOIN scripts ON scripts.id = renders.script_id JOIN briefs ON briefs.id = scripts.brief_id JOIN topics ON topics.id = briefs.topic_id JOIN channels ON channels.id = topics.channel_id
    WHERE renders.id = approvals.render_id AND channels.user_id = auth.uid()
  ));

CREATE POLICY "Channel owners can update approvals"
  ON approvals FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM renders JOIN scripts ON scripts.id = renders.script_id JOIN briefs ON briefs.id = scripts.brief_id JOIN topics ON topics.id = briefs.topic_id JOIN channels ON channels.id = topics.channel_id
    WHERE renders.id = approvals.render_id AND channels.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM renders JOIN scripts ON scripts.id = renders.script_id JOIN briefs ON briefs.id = scripts.brief_id JOIN topics ON topics.id = briefs.topic_id JOIN channels ON channels.id = topics.channel_id
    WHERE renders.id = approvals.render_id AND channels.user_id = auth.uid()
  ));

CREATE TABLE IF NOT EXISTS uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  render_id uuid NOT NULL REFERENCES renders(id) ON DELETE CASCADE,
  youtube_video_id text NOT NULL DEFAULT '',
  title text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  tags text[] NOT NULL DEFAULT '{}',
  thumbnail_path text NOT NULL DEFAULT '',
  playlist text NOT NULL DEFAULT '',
  scheduled_at timestamptz,
  published_at timestamptz,
  status text NOT NULL DEFAULT 'queued',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Channel owners can read uploads"
  ON uploads FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM renders JOIN scripts ON scripts.id = renders.script_id JOIN briefs ON briefs.id = scripts.brief_id JOIN topics ON topics.id = briefs.topic_id JOIN channels ON channels.id = topics.channel_id
    WHERE renders.id = uploads.render_id AND channels.user_id = auth.uid()
  ));

CREATE POLICY "Channel owners can insert uploads"
  ON uploads FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM renders JOIN scripts ON scripts.id = renders.script_id JOIN briefs ON briefs.id = scripts.brief_id JOIN topics ON topics.id = briefs.topic_id JOIN channels ON channels.id = topics.channel_id
    WHERE renders.id = uploads.render_id AND channels.user_id = auth.uid()
  ));

CREATE POLICY "Channel owners can update uploads"
  ON uploads FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM renders JOIN scripts ON scripts.id = renders.script_id JOIN briefs ON briefs.id = scripts.brief_id JOIN topics ON topics.id = briefs.topic_id JOIN channels ON channels.id = topics.channel_id
    WHERE renders.id = uploads.render_id AND channels.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM renders JOIN scripts ON scripts.id = renders.script_id JOIN briefs ON briefs.id = scripts.brief_id JOIN topics ON topics.id = briefs.topic_id JOIN channels ON channels.id = topics.channel_id
    WHERE renders.id = uploads.render_id AND channels.user_id = auth.uid()
  ));

CREATE TABLE IF NOT EXISTS analytics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id uuid NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  views integer NOT NULL DEFAULT 0,
  ctr numeric NOT NULL DEFAULT 0,
  avg_watch_duration numeric NOT NULL DEFAULT 0,
  likes integer NOT NULL DEFAULT 0,
  comments integer NOT NULL DEFAULT 0,
  subscribers_gained integer NOT NULL DEFAULT 0,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE analytics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Channel owners can read analytics"
  ON analytics FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM uploads JOIN renders ON renders.id = uploads.render_id JOIN scripts ON scripts.id = renders.script_id JOIN briefs ON briefs.id = scripts.brief_id JOIN topics ON topics.id = briefs.topic_id JOIN channels ON channels.id = topics.channel_id
    WHERE uploads.id = analytics.upload_id AND channels.user_id = auth.uid()
  ));

CREATE POLICY "Channel owners can insert analytics"
  ON analytics FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM uploads JOIN renders ON renders.id = uploads.render_id JOIN scripts ON scripts.id = renders.script_id JOIN briefs ON briefs.id = scripts.brief_id JOIN topics ON topics.id = briefs.topic_id JOIN channels ON channels.id = topics.channel_id
    WHERE uploads.id = analytics.upload_id AND channels.user_id = auth.uid()
  ));
