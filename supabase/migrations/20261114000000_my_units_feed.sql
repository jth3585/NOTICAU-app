-- 공지탭 '내 학과' 칩: 내 학과·복수전공·단과대 게시판 글 + 같은 소속 학생회 인스타 글을 최신순으로.
--
--  - 인스타 공지는 notices RLS(channel='board')에 막혀 있어 security definer 로 읽는다(events_feed 와 같은 이유).
--  - 소속 판정: sources.owner_unit 이 내 단위이거나, 학부 통합 게시판의 category_map.dept_group 에 내 단위가 있을 때.
--  - 교차출처 중복은 '내 게시판에 올라온 사본'을 살린다. 대표가 다른 게시판(본교 등)이어도 내 학과 게시판 글이면 보여주고,
--    내 소속 게시판 둘(학과+단과대)에 같은 글이 있으면 한 건만(대표 쪽 우선).
--  - 학년·캠퍼스·재학상태 등 타게팅은 앱이 notice_meta 로 거른다(isMismatch).
--  - 페이지: p_before(posted_at) 커서. 첫 페이지는 null.
--  - 응답 모양은 앱의 Notice 카드 select 와 같고 channel 만 추가.
create or replace function public.my_units_feed(p_units text[], p_before timestamptz default null, p_limit int default 200)
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
picked as (
  select n.*, s.parser_key, s.name as source_name, s.campus as source_campus, s.owner_unit,
         row_number() over (partition by coalesce(n.duplicate_of, n.id) order by (n.duplicate_of is not null), n.posted_at, n.id) as rn
  from public.notices n
  join mine s on s.id = n.source_id
  where p_before is null or n.posted_at < p_before
  order by n.posted_at desc
  limit least(greatest(coalesce(p_limit, 200), 1), 500) * 2
)
select jsonb_build_object(
  'id', p.id, 'source_id', p.source_id, 'title', p.title, 'source_url', p.source_url,
  'source_category', p.source_category, 'author', p.author, 'posted_at', p.posted_at,
  'crawled_at', p.crawled_at, 'is_pinned', p.is_pinned,
  -- 이 목록에선 내 게시판 사본이 곧 대표 → 피드 필터(duplicate_of is null)와 무관하게 null 로 내려준다.
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
from picked p
where p.rn = 1
order by p.posted_at desc, p.id
limit least(greatest(coalesce(p_limit, 200), 1), 500);
$$;
revoke all on function public.my_units_feed(text[], timestamptz, int) from public;
grant execute on function public.my_units_feed(text[], timestamptz, int) to anon, authenticated;
