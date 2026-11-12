-- 알림함(홈 우상단 🔔): 키워드 알림·데일리 브리핑(추후 '내 학과' 알림 등)을 기록해 모아보기.
-- 푸시를 꺼둔 사용자도 앱 안 알림함에는 쌓인다(푸시 발송 여부는 pushed 컬럼).
-- 알림을 누르면 notice_ids 의 공지만 모아 보여준다(1건이면 바로 상세).
-- 보관 14일(매일 정리 cron).

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,                         -- 'keyword' | 'digest' | (추후) 'dept' 등
  title text not null,
  body text not null,
  notice_ids uuid[] not null default '{}',
  data jsonb not null default '{}'::jsonb,    -- 타입별 부가정보(예: 매칭 키워드 목록)
  pushed boolean not null default false,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists notifications_user_created_idx on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "own notifications select" on public.notifications;
create policy "own notifications select" on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "own notifications update" on public.notifications;
create policy "own notifications update" on public.notifications
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- 클라이언트는 조회 + read_at 갱신만. 생성은 서버(service role)만.
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

-- 14일 지난 알림 정리 (매일 03:50 UTC)
select cron.unschedule('purge_notifications') where exists (select 1 from cron.job where jobname = 'purge_notifications');
select cron.schedule('purge_notifications', '50 3 * * *', $$delete from public.notifications where created_at < now() - interval '14 days'$$);
