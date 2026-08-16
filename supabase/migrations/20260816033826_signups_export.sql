-- 가입자 시트 동기화 (2026-08-16)
--
-- 닉네임을 설정한 가입자(= 온보딩 완료 유저)의 프로필/키워드/스크랩 현황을
-- 매일 Google Sheets로 내보내기 위한 조회 함수.
--
-- auth.users(가입일시)와 public 테이블을 조인해야 해서 security definer 필요.
-- 개인정보 덤프이므로 anon/authenticated는 실행 차단하고 service_role(=Edge Function)만 허용.

create or replace function public.signups_export()
returns table (
  user_id uuid,
  joined_at timestamptz,
  nickname text,
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
  join public.profiles p on p.user_id = u.id
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
  where p.nickname is not null and btrim(p.nickname) <> ''
  order by u.created_at desc
$$;

revoke execute on function public.signups_export() from public, anon, authenticated;
grant execute on function public.signups_export() to service_role;

-- cron 등록은 별도 마이그레이션(20260816xxxxxx_signups_export_cron.sql).
-- 함수 배포 + 시트 공유가 끝난 뒤에 걸어야 실패 실행이 쌓이지 않음.
