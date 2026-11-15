-- 행사 알림: 내 학과·단과대 행사(참여 이벤트 포함)가 새로 올라오면 알림함에 기록하고 푸시를 보낸다.
-- 발송은 event_extract 엣지 함수의 마지막 단계(sendEventAlerts)가 한다.

-- 이 행사 글을 알렸는가. 이미 있던 글은 알리지 않도록 지금 시각으로 채운다.
alter table public.notice_events add column if not exists alerted_at timestamptz;
update public.notice_events set alerted_at = now() where alerted_at is null;

-- 행사 알림 수신 여부. null = 이 기능을 모르는 구버전 앱(보내지 않는다), true = 받기, false = 끔.
-- 새 앱이 첫 실행 때 null → true 로 바꾼다. 구버전 앱은 인스타 공지를 열지 못하므로 이렇게 가른다.
alter table public.profiles add column if not exists event_alerts_enabled boolean;

-- 알릴 행사 글. 운영: 아직 안 알린 글 중 최근 24시간 안에 수집되고 게시 3일 이내인 것.
-- p_ids 를 주면 그 글들을 조건 없이 돌려준다(드라이런 검증용).
--  units       : 이 글의 소속 단위(게시판 소속·묶음 학과·대상 학과) — 사용자의 학과·단과대와 겹치면 '내 학과 행사'
--  similar_ids : 같은 행사로 보이는 다른 글(게시판과 인스타에 같이 올라온 경우 한 번만 알리기 위함)
create or replace function public.events_needing_alert(lim int default 10, p_ids uuid[] default null)
returns setof jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
with ev as (
  select e.notice_id, e.kind, e.event_name, e.event_start_at, e.event_end_at, e.event_place, e.alerted_at, e.poster_read_at,
         n.title, n.channel, n.posted_at, n.crawled_at, n.duplicate_of,
         coalesce(array_length(n.body_image_urls, 1), 0) as imgs,
         s.campus as source_campus, s.owner_unit, s.category_map,
         m.target_depts, m.target_grades, m.target_campuses, m.excludes_undergrad,
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
      -- 포스터 재확인이 남은 글은 일시가 채워진 뒤에 알린다(events_needing_poster_read 와 같은 조건).
      and not (c.event_start_at is null and (c.kind = 'event' or c.event_end_at is null)
               and c.poster_read_at is null and c.imgs > 0)
      -- 이미 지난 행사는 알리지 않는다.
      and (coalesce(c.event_end_at, c.event_start_at) is null
           or coalesce(c.event_end_at, c.event_start_at) > now() - interval '1 day')
  end
  order by c.crawled_at, c.notice_id
  limit lim
)
select jsonb_build_object(
  'notice_id', c.notice_id, 'kind', c.kind, 'event_name', c.event_name, 'title', c.title,
  'event_start_at', c.event_start_at, 'event_end_at', c.event_end_at, 'event_place', c.event_place,
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
