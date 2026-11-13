-- 행사 탭: 공지에서 뽑은 '행사' 정보 저장 + 조회 RPC.
--
-- event_extract(엣지 함수, 5분 cron)가 분류가 끝난 공지를 한 번 더 읽어 kind/일시/장소/공개범위를 채운다.
-- llm_classify(topic 분류)와는 완전히 분리 — 기존 notice_meta·피드 쿼리에는 영향 없음.
--
--  kind: event(참석형 행사) | giveaway(경품·혜택 참여형) | election(학생회 선거) | general(그 외)
--        null = 추출 실패(attempts<3 이면 재시도)
--  event_open: all(타 학과도 참석 가능) | members(주최 학과·단과대 구성원만)

create table if not exists public.notice_events (
  notice_id uuid primary key references public.notices(id) on delete cascade,
  kind text check (kind in ('event', 'giveaway', 'election', 'general')),
  event_name text,
  event_start_at timestamptz,
  event_end_at timestamptz,
  event_place text,
  audience_quote text,                        -- 원문에서 참석 대상을 밝힌 구절(검수용)
  event_open text check (event_open in ('all', 'members')),
  llm_model text,
  attempts int not null default 0,
  last_error text,
  processed_at timestamptz not null default now()
);

create index if not exists notice_events_live_idx on public.notice_events (kind)
  where kind in ('event', 'giveaway');

alter table public.notice_events enable row level security;

-- notice_meta 와 같은 수준의 공개 정보(읽기 전용). 쓰기는 service role 만.
drop policy if exists "public read notice_events" on public.notice_events;
create policy "public read notice_events" on public.notice_events for select using (true);
revoke all on public.notice_events from anon, authenticated;
grant select on public.notice_events to anon, authenticated;

-- 학부 통합 게시판의 소속 학과 묶음을 DB 에도 둔다(지금까지는 llm_classify 코드에만 있었음).
-- events_feed 가 '이 게시판이 어느 학과들 것인가'를 SQL 로 판단하는 데 쓴다.
update public.sources s set category_map = coalesce(s.category_map, '{}'::jsonb) || jsonb_build_object('dept_group', v.grp)
from (values
  ('cau_euro',   '["euro_german","euro_french","euro_russian"]'::jsonb),
  ('cau_asia',   '["asia_japanese","asia_chinese"]'::jsonb),
  ('cau_infra',  '["civil_plant","urban_sys"]'::jsonb),
  ('cau_arts',   '["art","art_seoul"]'::jsonb),
  ('cau_music',  '["composition","vocal","piano","orchestra"]'::jsonb),
  ('cau_kmusic', '["trad_music","trad_perform"]'::jsonb)
) as v(parser_key, grp)
where s.parser_key = v.parser_key and not (coalesce(s.category_map, '{}'::jsonb) ? 'dept_group');

-- event_extract 가 처리할 공지: 분류는 끝났는데 행사 추출이 아직이거나 실패(3회 미만)한 것.
-- 행사는 다가올 일정만 의미가 있어 최근 45일 게시분으로 한정(비용·백필 범위 제한).
create or replace function public.notices_needing_events(lim int default 30)
returns table (id uuid, attempts int)
language sql
stable
set search_path to 'public'
as $$
  select n.id, coalesce(e.attempts, 0)
  from public.notices n
  join public.notice_meta m on m.notice_id = n.id
  left join public.notice_events e on e.notice_id = n.id
  where (e.notice_id is null or (e.kind is null and e.attempts < 3))
    and n.posted_at > now() - interval '45 days'
  order by n.posted_at desc
  limit lim;
$$;
revoke all on function public.notices_needing_events(int) from public, anon, authenticated;
grant execute on function public.notices_needing_events(int) to service_role;

-- 행사 이름 유사도(0~1): 글자 2-gram 기준. 같은 행사를 게시판마다 조금씩 다르게 적은 글을 묶는 데 쓴다.
--  - 기본은 자카드(교집합/합집합).
--  - 한쪽 이름이 다른 쪽에 수식어만 덧붙인 꼴("파견 교환학생 설명회" vs "…전체 설명회(다빈치 캠퍼스)")은
--    자카드가 낮게 나오므로, 짧은 쪽 기준 포함률(교집합/짧은 쪽)에 0.6 을 곱한 값과 비교해 큰 쪽을 쓴다.
--    짧은 쪽이 2-gram 4개 미만("특강" 등)이면 우연히 포함되기 쉬워 포함률은 쓰지 않는다.
-- (pg_trgm 은 DB 로캘에 따라 한글을 무시할 수 있어 직접 계산한다. 비교 대상이 수십 건이라 비용은 무시할 수준.)
create or replace function public.event_name_sim(a text, b text)
returns real
language sql
immutable
set search_path to 'public'
as $$
  with ga as (select distinct substr(a, i, 2) as g from generate_series(1, greatest(length(a) - 1, 1)) i),
       gb as (select distinct substr(b, i, 2) as g from generate_series(1, greatest(length(b) - 1, 1)) i),
       c as (select (select count(*) from ga join gb using (g))::real as both,
                    (select count(*) from ga)::real as na, (select count(*) from gb)::real as nb)
  select case when coalesce(a, '') = '' or coalesce(b, '') = '' then 0::real
    else greatest(
      c.both / nullif(c.na + c.nb - c.both, 0),
      case when least(c.na, c.nb) >= 4 then 0.6 * c.both / least(c.na, c.nb) else 0 end)::real end
  from c;
$$;

-- 행사 탭 피드: 아직 끝나지 않은 행사·참여 이벤트(게시판 + 인스타).
--  - 인스타 공지는 notices RLS(channel='board')에 막혀 있어 security definer 로 읽는다.
--  - 같은 행사를 여러 게시판이 올린 글은 대표 1건으로 묶는다.
--      · 일시가 있는 글끼리: 같은 날 + (시작 시각이 같거나 한쪽이 시간 미상) + 이름 유사도 0.45 이상
--      · 일시를 못 뽑은 글: 이름이 거의 같은(0.75 이상) 글에 합류(일시 있는 쪽 우선)
--    대표 = 일시 있는 글 > 본교 > 행정부서 > 단과대 > 학과 순, 그다음 먼저 올라온 글.
--  - event.open: 묶음 안에 하나라도 '누구나'면 true. false 면 member_units(주최 소속 코드)에
--    내 학과·단과대가 있을 때만 앱이 노출한다. 학년·캠퍼스 등 나머지 타게팅은 앱이 notice_meta 로 거른다.
--  - 응답 모양은 앱의 Notice 타입(카드 select)과 같고 event 객체만 추가.
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
    'open', g.g_open, 'member_units', coalesce(g.member_units, '{}'::text[]))
)
from ranked r
join agg g on g.gkey = r.gkey
where r.rn = 1
order by r.kind, r.event_start_at nulls last, r.posted_at desc;
$$;
revoke all on function public.events_feed() from public;
grant execute on function public.events_feed() to anon, authenticated;

-- 상세 화면용 단건 조회. 게시판 공지는 기존처럼 테이블을 직접 읽고, RLS 에 막힌 인스타 공지만 이 RPC 로 폴백한다.
-- (인스타 게시물은 원래 공개 글이고 notice_meta 도 이미 공개 읽기 — RLS 는 '구버전 앱 피드에 섞이지 않게' 하는 용도.)
create or replace function public.notice_by_id(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select (to_jsonb(n) - 'content_hash' - 'post_key' - 'classify_attempts' - 'classify_last_error')
    || jsonb_build_object(
      'notice_meta', (select to_jsonb(m) from public.notice_meta m where m.notice_id = n.id),
      'sources', (select jsonb_build_object('parser_key', s.parser_key, 'name', s.name, 'campus', s.campus, 'owner_unit', s.owner_unit)
                  from public.sources s where s.id = n.source_id))
  from public.notices n
  where n.id = p_id;
$$;
revoke all on function public.notice_by_id(uuid) from public;
grant execute on function public.notice_by_id(uuid) to anon, authenticated;

-- 5분마다 행사 추출 (llm_classify 는 0,5,10…분 → 3분 뒤에 돌려 방금 분류된 공지를 이어서 처리)
select cron.unschedule('event_extract') where exists (select 1 from cron.job where jobname = 'event_extract');
select cron.schedule('event_extract', '3-59/5 * * * *', $$SELECT net.http_post(url:='https://ntepavohsldelxaiubip.supabase.co/functions/v1/event_extract',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='cron_secret')),
    body:='{}'::jsonb, timeout_milliseconds:=150000);$$);
