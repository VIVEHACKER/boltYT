-- 채널 팀 멤버 테이블
create table if not exists channel_members (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete cascade,
  user_id uuid references auth.users(id),
  email text not null,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  invited_by uuid references auth.users(id),
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique(channel_id, email)
);

-- TikTok / Instagram 필드 추가
alter table uploads
  add column if not exists tiktok_video_id text,
  add column if not exists instagram_media_id text,
  add column if not exists platform text check (platform in ('youtube', 'tiktok', 'instagram'));

-- RLS
alter table channel_members enable row level security;

create policy "channel_members: member read"
  on channel_members for select
  using (
    user_id = auth.uid()
    or invited_by = auth.uid()
    or exists (
      select 1 from channel_members cm2
      where cm2.channel_id = channel_members.channel_id
        and cm2.user_id = auth.uid()
    )
  );

create policy "channel_members: owner insert"
  on channel_members for insert
  with check (
    exists (
      select 1 from channel_members cm2
      where cm2.channel_id = channel_id
        and cm2.user_id = auth.uid()
        and cm2.role = 'owner'
    )
    -- 채널 최초 소유자 등록 허용 (아직 멤버 없을 때)
    or not exists (
      select 1 from channel_members cm3
      where cm3.channel_id = channel_id
    )
  );

create policy "channel_members: owner delete"
  on channel_members for delete
  using (
    exists (
      select 1 from channel_members cm2
      where cm2.channel_id = channel_members.channel_id
        and cm2.user_id = auth.uid()
        and cm2.role = 'owner'
    )
    and role != 'owner'
  );
