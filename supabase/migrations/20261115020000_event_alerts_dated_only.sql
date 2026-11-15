-- 행사 알림은 날짜가 있는 글만 보낸다(행사 탭이 날짜 없는 글을 싣지 않는 것과 같은 원칙).
-- 날짜 없는 글에 먼저 알리면, 나중에 일정이 적혀 올라온 글이 '같은 행사'로 묶여 알림이 가지 않는다.
--  - 참석 행사: 시작일이 있어야 한다(포스터 재확인으로 나중에 채워지면 그때 알린다).
--  - 참여 이벤트: 마감(행사 종료일 또는 공지의 신청 마감)이 있어야 한다.
create or replace function public.events_needing_alert(lim int default 10, p_ids uuid[] default null)
returns setof jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
with ev as (
  select e.notice_id, e.kind, e.event_name, e.event_start_at, e.event_end_at, e.event_place, e.alerted_at,
         n.title, n.channel, n.posted_at, n.crawled_at, n.duplicate_of,
         s.campus as source_campus, s.owner_unit, s.category_map,
         m.target_depts, m.target_grades, m.target_campuses, m.excludes_undergrad, m.deadline_at,
         to_char(e.event_start_at at time zone 'Asia/Seoul', 'YYYY-MM-DD') as dkey,
         regexp_replace(
           regexp_replace(lower(coalesce(e.event_name, n.title)), '20[0-9]{2}(학년도|년도|년)?|[0-9]학기', '', 'g'),
           '[^가-힣a-z0-9]', '', 'g') as nname
  from public.notice_events e
  join public.notices n on n.id = e.notice_id
  join public.sources s on s.id = n.source_id
  left join public.notice_meta m on m.notice_id = n.id
  where e.kind in ('event', 'giveaway')
    and n.posted_at > now() - interval '30 days'
),
cand as (
  select c.* from ev c
  where case
    when p_ids is not null then c.notice_id = any(p_ids)
    else c.alerted_at is null
      and c.duplicate_of is null
      and c.crawled_at > now() - interval '24 hours'
      and c.posted_at > now() - interval '3 days'
      and case when c.kind = 'event' then c.event_start_at is not null
               else coalesce(c.deadline_at, c.event_end_at) is not null end
      -- 이미 지난 행사는 알리지 않는다.
      and coalesce(c.event_end_at, c.event_start_at, c.deadline_at) > now() - interval '1 day'
  end
  order by c.crawled_at, c.notice_id
  limit lim
)
select jsonb_build_object(
  'notice_id', c.notice_id, 'kind', c.kind, 'event_name', c.event_name, 'title', c.title,
  'event_start_at', c.event_start_at,
  'event_end_at', case when c.kind = 'giveaway' then coalesce(c.deadline_at, c.event_end_at) else c.event_end_at end,
  'event_place', c.event_place,
  'source_campus', c.source_campus,
  'target_grades', c.target_grades, 'target_campuses', c.target_campuses, 'excludes_undergrad', c.excludes_undergrad,
  'units', (
    select coalesce(jsonb_agg(distinct u), '[]'::jsonb)
    from unnest(
      array[c.owner_unit]
      || coalesce((select array_agg(x) from jsonb_array_elements_text(
           case when jsonb_typeof(c.category_map -> 'dept_group') = 'array'
                then c.category_map -> 'dept_group' else '[]'::jsonb end) x), '{}'::text[])
      || coalesce(c.target_depts, '{}'::text[])
    ) as u
    where u is not null),
  'similar_ids', (
    select coalesce(jsonb_agg(o.notice_id), '[]'::jsonb)
    from ev o
    where o.notice_id <> c.notice_id and o.kind = c.kind
      and (
        (c.dkey is not null and o.dkey = c.dkey and public.event_name_sim(c.nname, o.nname) >= 0.45)
        or ((c.dkey is null or o.dkey is null) and length(c.nname) >= 5
            and public.event_name_sim(c.nname, o.nname) >= 0.75)
      ))
)
from cand c;
$$;

revoke execute on function public.events_needing_alert(int, uuid[]) from public, anon, authenticated;
grant execute on function public.events_needing_alert(int, uuid[]) to service_role;
