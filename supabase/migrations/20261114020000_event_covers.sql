-- 행사 탭 리디자인(이미지 중심): 행사 글의 포스터를 작은 커버 이미지로 만들어 둔다.
--
-- 원본 포스터는 장당 0.4~3MB 이고 외부 접근 차단·http 전용 호스트도 있어 앱이 목록에서 직접 쓸 수 없다.
-- event_extract 가 수집 시점에 가로 720px WebP(수십 KB)로 줄여 Storage 'crawled-images/ev/<notice_id>.webp' 에
-- 올리고 그 공개 URL 을 notice_events.cover_url 에 적는다. 인스타 원본 이미지의 30일 정리와는 별개 객체라
-- 원본이 지워져도 커버는 남는다(커버는 게시 75일 뒤 따로 정리).
--
--  cover_ratio: 커버의 가로/세로 비. 앱이 포스터 칸(세로형)에 꽉 채울지, 흐린 배경 위에 통째로 얹을지 정한다.
--  cover_attempts: 실패 횟수. 3이면 더 시도하지 않는다(쓸 만한 이미지가 없는 글도 3으로 닫는다).

alter table public.notice_events
  add column if not exists cover_url text,
  add column if not exists cover_ratio real,
  add column if not exists cover_attempts int not null default 0;

-- 커버를 만들 행사: 이미지가 있는데 커버가 아직 없는 최근 60일 게시분(events_feed 노출 범위와 같다).
create or replace function public.events_needing_covers(lim int default 8)
returns table (notice_id uuid, body_image_urls text[], cover_attempts int)
language sql
stable
set search_path to 'public'
as $$
  select e.notice_id, n.body_image_urls, e.cover_attempts
  from public.notice_events e
  join public.notices n on n.id = e.notice_id
  where e.kind in ('event', 'giveaway')
    and e.cover_url is null
    and e.cover_attempts < 3
    and coalesce(array_length(n.body_image_urls, 1), 0) > 0
    and n.posted_at > now() - interval '60 days'
  order by n.posted_at desc
  limit lim;
$$;
revoke all on function public.events_needing_covers(int) from public, anon, authenticated;
grant execute on function public.events_needing_covers(int) to service_role;

-- 정리할 커버: 게시 75일이 지나 행사 탭에 더 나오지 않는 글.
create or replace function public.event_covers_expired(lim int default 20)
returns table (notice_id uuid, cover_url text)
language sql
stable
set search_path to 'public'
as $$
  select e.notice_id, e.cover_url
  from public.notice_events e
  join public.notices n on n.id = e.notice_id
  where e.cover_url is not null
    and n.posted_at < now() - interval '75 days'
  order by n.posted_at
  limit lim;
$$;
revoke all on function public.event_covers_expired(int) from public, anon, authenticated;
grant execute on function public.event_covers_expired(int) to service_role;

-- events_feed: event 객체에 cover_url·cover_ratio 추가(그 밖의 로직은 20261113000000 과 같다).
-- 묶음 대표 글에 커버가 없으면 같은 묶음의 다른 글 커버를 빌려 쓴다(본교 글은 글만, 학과 글에 포스터가 있는 경우).
create or replace function public.events_feed()
returns setof jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
with base as (
  select n.id, n.source_id, n.title, n.source_url, n.source_category, n.author, n.posted_at, n.crawled_at,
         n.is_pinned, n.channel,
         e.kind, e.event_name, e.event_start_at, e.event_end_at, e.event_place, e.event_open,
         e.cover_url, e.cover_ratio,
         s.parser_key, s.name as source_name, s.campus as source_campus, s.owner_unit, s.scope_type, s.category_map,
         m.topic, m.action, m.apply_start_at, m.deadline_at, m.target_grades, m.target_depts, m.target_campuses,
         m.target_enrollment_status, m.targets_freshmen, m.excludes_undergrad,
         -- 행사가 끝나는 시각. 자정(00:00 KST)은 '시간 미상'이므로 그날 끝까지, 시작만 있으면 3시간 진행으로 본다.
         case
           when e.event_end_at is not null then
             case when (e.event_end_at at time zone 'Asia/Seoul')::time = time '00:00'
                  then e.event_end_at + interval '1 day' else e.event_end_at end
           when e.event_start_at is not null then
             case when (e.event_start_at at time zone 'Asia/Seoul')::time = time '00:00'
                  then e.event_start_at + interval '1 day' else e.event_start_at + interval '3 hours' end
         end as ev_fin
  from public.notice_events e
  join public.notices n on n.id = e.notice_id
  join public.sources s on s.id = n.source_id
  left join public.notice_meta m on m.notice_id = n.id
  where e.kind in ('event', 'giveaway')
    and n.duplicate_of is null
    and n.posted_at > now() - interval '60 days'
),
live as (
  -- 참여 이벤트는 신청 마감이 곧 끝. 마감이 없으면 진행 기간으로.
  select b.*, case when b.kind = 'giveaway' then coalesce(b.deadline_at, b.ev_fin) else b.ev_fin end as ends_at
  from base b
),
alive as (
  select l.*,
    to_char(l.event_start_at at time zone 'Asia/Seoul', 'YYYY-MM-DD') as dkey,
    coalesce((l.event_start_at at time zone 'Asia/Seoul')::time = time '00:00', false) as dateonly,
    regexp_replace(
      regexp_replace(lower(coalesce(l.event_name, l.title)), '20[0-9]{2}(학년도|년도|년)?|[0-9]학기', '', 'g'),
      '[^가-힣a-z0-9]', '', 'g') as nname,
    case l.scope_type when 'university' then 0 when 'service' then 1 when 'college' then 2 else 3 end as prio
  from live l
  where (l.ends_at is not null and l.ends_at >= now())
     -- 일시를 못 뽑은 글은 최근 3주 게시분만 '일정 미정'으로 노출
     or (l.ends_at is null and l.posted_at > now() - interval '21 days')
),
led as (
  -- 각 글의 '묶음 대표 후보': 조건에 맞는 글 중 우선순위가 가장 높은 글(자기 자신 포함).
  select a.id,
    coalesce((
      select b.id from alive b
      where b.kind = a.kind
        and (
          (a.dkey is not null and b.dkey = a.dkey
             and (b.event_start_at = a.event_start_at or a.dateonly or b.dateonly)
             and public.event_name_sim(a.nname, b.nname) >= 0.45)
          or (a.dkey is null and length(a.nname) >= 5 and public.event_name_sim(a.nname, b.nname) >= 0.75)
        )
      order by (b.dkey is null), b.prio, b.posted_at, b.id
      limit 1), a.id) as leader
  from alive a
),
keyed as (
  -- 대표의 대표까지 한 번 더 따라가 묶음 키를 안정화(A→B, B→C 인 경우 모두 C 로).
  select a.*, coalesce((select l2.leader from led l2 where l2.id = l.leader), l.leader) as gkey
  from alive a join led l on l.id = a.id
),
units as (
  select k.gkey, u
  from keyed k
  cross join lateral unnest(
    array[k.owner_unit]
    || coalesce((select array_agg(x) from jsonb_array_elements_text(
         case when jsonb_typeof(k.category_map -> 'dept_group') = 'array'
              then k.category_map -> 'dept_group' else '[]'::jsonb end) x), '{}'::text[])
    || coalesce(k.target_depts, '{}'::text[])
  ) as u
  where u is not null
),
agg as (
  select k.gkey,
         bool_or(k.event_open is distinct from 'members') as g_open,
         (select array_agg(distinct u.u) from units u where u.gkey = k.gkey) as member_units
  from keyed k
  group by k.gkey
),
ranked as (
  select k.*, row_number() over (partition by k.gkey order by (k.dkey is null), k.prio, k.posted_at, k.id) as rn
  from keyed k
)
select jsonb_build_object(
  'id', r.id, 'source_id', r.source_id, 'title', r.title, 'source_url', r.source_url,
  'source_category', r.source_category, 'author', r.author, 'posted_at', r.posted_at,
  'crawled_at', r.crawled_at, 'is_pinned', r.is_pinned, 'duplicate_of', null,
  'dup_count', (select count(distinct k2.source_id) from keyed k2 where k2.gkey = r.gkey and k2.source_id <> r.source_id),
  'dup_source_keys', (select array_agg(distinct k2.parser_key) from keyed k2 where k2.gkey = r.gkey and k2.source_id <> r.source_id),
  'channel', r.channel,
  'notice_meta', jsonb_build_object(
    'notice_id', r.id, 'topic', r.topic, 'action', r.action, 'apply_start_at', r.apply_start_at,
    'deadline_at', r.deadline_at, 'target_grades', r.target_grades, 'target_depts', r.target_depts,
    'target_campuses', r.target_campuses, 'target_enrollment_status', r.target_enrollment_status,
    'targets_freshmen', coalesce(r.targets_freshmen, false), 'excludes_undergrad', r.excludes_undergrad),
  'sources', jsonb_build_object(
    'parser_key', r.parser_key, 'name', r.source_name, 'campus', r.source_campus, 'owner_unit', r.owner_unit),
  'event', jsonb_build_object(
    'kind', r.kind, 'name', r.event_name, 'start_at', r.event_start_at, 'end_at', r.event_end_at,
    'place', r.event_place, 'ends_at', r.ends_at,
    'open', g.g_open, 'member_units', coalesce(g.member_units, '{}'::text[]),
    'cover_url', c.cover_url, 'cover_ratio', c.cover_ratio)
)
from ranked r
join agg g on g.gkey = r.gkey
left join lateral (
  -- 대표 글의 커버 우선, 없으면 같은 묶음에서 우선순위가 높은 글의 커버
  select k2.cover_url, k2.cover_ratio
  from keyed k2
  where k2.gkey = r.gkey and k2.cover_url is not null
  order by (k2.id = r.id) desc, k2.prio, k2.posted_at, k2.id
  limit 1
) c on true
where r.rn = 1
order by r.kind, r.event_start_at nulls last, r.posted_at desc;
$$;
revoke all on function public.events_feed() from public;
grant execute on function public.events_feed() to anon, authenticated;
