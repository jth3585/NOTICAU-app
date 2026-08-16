-- 가입자 시트: 최근 활동에 user_feed_state 폴백 (2026-08-16)
--
-- 기존 last_active_at은 user_events만 봤는데, 이 테이블은 2026-07-02부터 쌓이기 시작했고
-- 로깅되는 행동도 5종(notice_open/bookmark_add/search/calendar_add/share)뿐이다.
-- 그 결과 무이벤트 유저 78명 중 47명이 실제로는 앱을 쓴 사람인데도 빈칸이었다
-- (user_feed_state에 읽음/닫음/북마크 기록이 남아 있음).
--
-- → user_feed_state의 read_at/dismissed_at/bookmarked_at 최신값과 함께 greatest로 묶는다.
--   빈칸은 "정말 공지를 한 번도 안 연 유저"만 남는다.
--   (greatest는 NULL을 무시하므로 한쪽만 있어도 정상 동작)

create or replace function public.signups_export()
returns table (
  user_id uuid,
  joined_at timestamptz,
  nickname text,
  onboarded boolean,
  college_name text,
  dept_name text,
  dept_secondary_name text,
  grade integer,
  campus text,
  enrollment_status text[],
  is_dormitory boolean,
  career_paths text[],
  notifications_enabled boolean,
  keyword_count bigint,
  keywords text,
  bookmark_count bigint,
  last_active_at timestamptz
)
language sql
security definer
set search_path to 'public', 'auth'
as $$
  select
    u.id,
    u.created_at,
    p.nickname,
    p.onboarded_at is not null,
    c.name,
    d.name,
    d2.name,
    p.grade,
    p.campus,
    p.enrollment_status,
    p.is_dormitory,
    p.career_paths,
    p.notifications_enabled,
    coalesce(k.cnt, 0),
    k.list,
    coalesce(b.cnt, 0),
    greatest(e.last_at, f.last_touch)
  from auth.users u
  left join public.profiles p on p.user_id = u.id
  left join public.departments d on d.code = p.dept
  left join public.departments d2 on d2.code = p.dept_secondary
  left join public.colleges c on c.code = p.college
  left join lateral (
    select count(*) as cnt, string_agg(keyword, ', ' order by created_at) as list
    from public.user_keywords where user_id = u.id
  ) k on true
  left join lateral (
    select count(*) as cnt
    from public.user_feed_state where user_id = u.id and bookmarked_at is not null
  ) b on true
  left join lateral (
    select max(created_at) as last_at
    from public.user_events where user_id = u.id
  ) e on true
  left join lateral (
    select max(greatest(read_at, dismissed_at, bookmarked_at)) as last_touch
    from public.user_feed_state where user_id = u.id
  ) f on true
  order by u.created_at desc
$$;

revoke execute on function public.signups_export() from public, anon, authenticated;
grant execute on function public.signups_export() to service_role;
