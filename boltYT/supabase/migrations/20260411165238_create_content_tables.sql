/*
  # Create content pipeline tables

  1. New Tables
    - `topics` - content topics per channel
      - `id`, `channel_id`, `title`, `status`, `source`, `created_at`
    - `briefs` - AI-generated content briefs
      - `id`, `topic_id`, `core_message`, `target_audience`, `cautions`, `shorts_hooks`, `longform_outline`, `created_at`
    - `scripts` - generated scripts (shorts/longform)
      - `id`, `brief_id`, `format`, `content_json`, `version`, `status`, `rejection_reason`, `created_at`
    - `scenes` - individual scenes within a script
      - `id`, `script_id`, `order_index`, `narration_text`, `scene_type`, `visual_prompt`, `duration_seconds`

  2. Security
    - RLS enabled on all tables
    - Access scoped to channel owner via join chain
*/

CREATE TABLE IF NOT EXISTS topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft',
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE topics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Channel owners can read topics"
  ON topics FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM channels WHERE channels.id = topics.channel_id AND channels.user_id = auth.uid()));

CREATE POLICY "Channel owners can insert topics"
  ON topics FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM channels WHERE channels.id = topics.channel_id AND channels.user_id = auth.uid()));

CREATE POLICY "Channel owners can update topics"
  ON topics FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM channels WHERE channels.id = topics.channel_id AND channels.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM channels WHERE channels.id = topics.channel_id AND channels.user_id = auth.uid()));

CREATE POLICY "Channel owners can delete topics"
  ON topics FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM channels WHERE channels.id = topics.channel_id AND channels.user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS briefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id uuid NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  core_message text NOT NULL DEFAULT '',
  target_audience text NOT NULL DEFAULT '',
  cautions text NOT NULL DEFAULT '',
  shorts_hooks text[] NOT NULL DEFAULT '{}',
  longform_outline jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE briefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Channel owners can read briefs"
  ON briefs FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM topics JOIN channels ON channels.id = topics.channel_id
    WHERE topics.id = briefs.topic_id AND channels.user_id = auth.uid()
  ));

CREATE POLICY "Channel owners can insert briefs"
  ON briefs FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM topics JOIN channels ON channels.id = topics.channel_id
    WHERE topics.id = briefs.topic_id AND channels.user_id = auth.uid()
  ));

CREATE POLICY "Channel owners can update briefs"
  ON briefs FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM topics JOIN channels ON channels.id = topics.channel_id
    WHERE topics.id = briefs.topic_id AND channels.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM topics JOIN channels ON channels.id = topics.channel_id
    WHERE topics.id = briefs.topic_id AND channels.user_id = auth.uid()
  ));

CREATE POLICY "Channel owners can delete briefs"
  ON briefs FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM topics JOIN channels ON channels.id = topics.channel_id
    WHERE topics.id = briefs.topic_id AND channels.user_id = auth.uid()
  ));

CREATE TABLE IF NOT EXISTS scripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_id uuid NOT NULL REFERENCES briefs(id) ON DELETE CASCADE,
  format text NOT NULL DEFAULT 'shorts',
  content_json jsonb NOT NULL DEFAULT '{}',
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'draft',
  rejection_reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE scripts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Channel owners can read scripts"
  ON scripts FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM briefs JOIN topics ON topics.id = briefs.topic_id JOIN channels ON channels.id = topics.channel_id
    WHERE briefs.id = scripts.brief_id AND channels.user_id = auth.uid()
  ));

CREATE POLICY "Channel owners can insert scripts"
  ON scripts FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM briefs JOIN topics ON topics.id = briefs.topic_id JOIN channels ON channels.id = topics.channel_id
    WHERE briefs.id = scripts.brief_id AND channels.user_id = auth.uid()
  ));

CREATE POLICY "Channel owners can update scripts"
  ON scripts FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM briefs JOIN topics ON topics.id = briefs.topic_id JOIN channels ON channels.id = topics.channel_id
    WHERE briefs.id = scripts.brief_id AND channels.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM briefs JOIN topics ON topics.id = briefs.topic_id JOIN channels ON channels.id = topics.channel_id
    WHERE briefs.id = scripts.brief_id AND channels.user_id = auth.uid()
  ));

CREATE POLICY "Channel owners can delete scripts"
  ON scripts FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM briefs JOIN topics ON topics.id = briefs.topic_id JOIN channels ON channels.id = topics.channel_id
    WHERE briefs.id = scripts.brief_id AND channels.user_id = auth.uid()
  ));

CREATE TABLE IF NOT EXISTS scenes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  script_id uuid NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
  order_index integer NOT NULL DEFAULT 0,
  narration_text text NOT NULL DEFAULT '',
  scene_type text NOT NULL DEFAULT 'image',
  visual_prompt text NOT NULL DEFAULT '',
  duration_seconds numeric NOT NULL DEFAULT 5.0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE scenes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Channel owners can read scenes"
  ON scenes FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM scripts JOIN briefs ON briefs.id = scripts.brief_id JOIN topics ON topics.id = briefs.topic_id JOIN channels ON channels.id = topics.channel_id
    WHERE scripts.id = scenes.script_id AND channels.user_id = auth.uid()
  ));

CREATE POLICY "Channel owners can insert scenes"
  ON scenes FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM scripts JOIN briefs ON briefs.id = scripts.brief_id JOIN topics ON topics.id = briefs.topic_id JOIN channels ON channels.id = topics.channel_id
    WHERE scripts.id = scenes.script_id AND channels.user_id = auth.uid()
  ));

CREATE POLICY "Channel owners can update scenes"
  ON scenes FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM scripts JOIN briefs ON briefs.id = scripts.brief_id JOIN topics ON topics.id = briefs.topic_id JOIN channels ON channels.id = topics.channel_id
    WHERE scripts.id = scenes.script_id AND channels.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM scripts JOIN briefs ON briefs.id = scripts.brief_id JOIN topics ON topics.id = briefs.topic_id JOIN channels ON channels.id = topics.channel_id
    WHERE scripts.id = scenes.script_id AND channels.user_id = auth.uid()
  ));

CREATE POLICY "Channel owners can delete scenes"
  ON scenes FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM scripts JOIN briefs ON briefs.id = scripts.brief_id JOIN topics ON topics.id = briefs.topic_id JOIN channels ON channels.id = topics.channel_id
    WHERE scripts.id = scenes.script_id AND channels.user_id = auth.uid()
  ));
