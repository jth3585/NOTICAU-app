-- 가입자 시트: 전체 가입자로 확대 (2026-08-16)
--
-- 기존에는 닉네임(호칭)을 설정한 유저만 내보냈으나, 닉네임은 온보딩에서 skip 가능한
-- 선택 입력이라 이걸로 거르면 온보딩을 마친 유저도 대량 누락됨(228/392).
-- 또한 profiles 행 자체가 없는 온보딩 미완료 가입자(auth.users만 존재)도 현황상 필요.
--
-- → profiles를 left join으로 바꿔 auth.users 전체를 대상으로 하고,
--   onboarded 칼럼으로 온보딩 완료/미완료를 구분한다.
--
-- 반환 칼럼이 늘어나므로 create or replace 불가 → drop 후 재생성.

drop function if exists public.signups_export();

create function public.signups_export()
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
    e.last_at
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
  order by u.created_at desc
$$;

revoke execute on function public.signups_export() from public, anon, authenticated;
grant execute on function public.signups_export() to service_role;
