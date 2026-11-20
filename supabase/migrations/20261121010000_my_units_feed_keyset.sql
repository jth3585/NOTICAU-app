-- '내 학과' 칩 페이지 넘김 수정.
--
-- 1) 커서를 (posted_at, id) 로: posted_at 만 쓰면 날짜만 있는 게시판 글이 모두 00:00(KST)이라
--    페이지 경계와 같은 시각의 나머지 글이 'posted_at < p_before' 에 걸려 영영 안 나왔다.
--    p_before_id 가 없으면(구버전 앱) 예전처럼 posted_at 만 본다.
-- 2) 중복 묶음(교차출처) 판정을 커서로 거르기 '전에' 한다: 거른 뒤에 하면 앞 페이지에서 대표를 이미
--    보여 준 묶음의 사본이 뒤 페이지에서 혼자 남아 rn=1 이 되어 다시 나왔다.
--    (내 소속 게시판 글은 많아야 수천 건이라 매번 전체에 대해 묶음을 계산해도 가볍다.)
-- 정렬은 posted_at desc, id desc 로 통일(커서 비교와 같은 순서).
drop function if exists public.my_units_feed(text[], timestamptz, int);

create or replace function public.my_units_feed(
  p_units text[],
  p_before timestamptz default null,
  p_limit int default 200,
  p_before_id uuid default null
)
returns setof jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
with mine as (
  select s.id, s.parser_key, s.name, s.campus, s.owner_unit
  from public.sources s
  where coalesce(array_length(p_units, 1), 0) > 0
    and (s.owner_unit = any(p_units)
         or (jsonb_typeof(s.category_map -> 'dept_group') = 'array' and (s.category_map -> 'dept_group') ?| p_units))
),
ranked as (
  select n.*, s.parser_key, s.name as source_name, s.campus as source_campus, s.owner_unit,
         row_number() over (partition by coalesce(n.duplicate_of, n.id) order by (n.duplicate_of is not null), n.posted_at, n.id) as rn
  from public.notices n
  join mine s on s.id = n.source_id
),
page as (
  select r.*
  from ranked r
  where r.rn = 1
    and (
      p_before is null
      or (p_before_id is null and r.posted_at < p_before)
      or (p_before_id is not null and (r.posted_at, r.id) < (p_before, p_before_id))
    )
  order by r.posted_at desc, r.id desc
  limit least(greatest(coalesce(p_limit, 200), 1), 500)
)
select jsonb_build_object(
  'id', p.id, 'source_id', p.source_id, 'title', p.title, 'source_url', p.source_url,
  'source_category', p.source_category, 'author', p.author, 'posted_at', p.posted_at,
  'crawled_at', p.crawled_at, 'is_pinned', p.is_pinned,
  'duplicate_of', null, 'dup_count', p.dup_count, 'dup_source_keys', p.dup_source_keys,
  'channel', p.channel,
  'notice_meta', (select jsonb_build_object(
      'notice_id', m.notice_id, 'topic', m.topic, 'action', m.action, 'apply_start_at', m.apply_start_at,
      'deadline_at', m.deadline_at, 'target_grades', m.target_grades, 'target_depts', m.target_depts,
      'target_campuses', m.target_campuses, 'target_enrollment_status', m.target_enrollment_status,
      'targets_freshmen', coalesce(m.targets_freshmen, false), 'excludes_undergrad', m.excludes_undergrad)
    from public.notice_meta m where m.notice_id = p.id),
  'sources', jsonb_build_object(
    'parser_key', p.parser_key, 'name', p.source_name, 'campus', p.source_campus, 'owner_unit', p.owner_unit)
)
from page p
order by p.posted_at desc, p.id desc;
$$;

revoke all on function public.my_units_feed(text[], timestamptz, int, uuid) from public;
grant execute on function public.my_units_feed(text[], timestamptz, int, uuid) to anon, authenticated;
