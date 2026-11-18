-- 크롤러 감시 (2026-11-18)
--
-- 배경: 산업보안학과(사이트 개편 → 404, 8/31부터), 영어교육과(사이트 접속 불가, 10/21부터),
--       영어영문학과(서버 IP 에 자동등록방지 화면 → 목록 0건, 9/17부터), 화학과(처음부터 안 쓰는 게시판을 봄)가
--       몇 달씩 수집이 끊겼는데 아무도 몰랐다. crawler_health 는 있었지만 실패해도 is_healthy 가 true 로 남았고,
--       '에러 없이 0건'인 경우는 원래 잡을 수 없었다.
--
-- 1) crawler_health 를 실제 상태로: 실패하면 is_healthy=false, failure_count 누적, first_failure_at 기록(트리거).
--    크롤러 80여 개의 코드는 그대로 둔다(성공 시 last_success_at 갱신, 실패 시 last_error 만 쓰는 기존 방식).
-- 2) crawler_watch_issues(): 지금 문제인 소스 목록
--    - error    : 6시간 넘게 연속 실패
--    - stalled  : 26시간 넘게 실행 기록이 없음(cron 이 빠졌거나 멈춤)
--    - quiet    : 새 글이 평소 간격보다 훨씬 오래 없음 = 3 × (최근 1년 게시 간격 90퍼센타일), 21~60일로 제한.
--                 등록 14일이 지났는데 한 번도 수집되지 않은 소스도 여기.
--                 원래 글이 드문 게시판은 sources.watch_quiet_ok_until 로 기간을 정해 끈다(watch_note 에 이유).
-- 3) crawler_alerts: 알림 상태(같은 문제를 매일 다시 알리지 않게). crawler_watch 엣지 함수가 관리.
-- 4) ops_admins: 알림을 받을 관리자 user_id.

-- 1) crawler_health 상태 추적 ------------------------------------------------
alter table public.crawler_health add column if not exists first_failure_at timestamptz;

-- 이미 실패 중인 행 정리(트리거 만들기 전에)
update public.crawler_health
set is_healthy = false,
    failure_count = greatest(failure_count, 1),
    first_failure_at = coalesce(last_success_at, last_attempt_at)
where last_error is not null
  and (last_success_at is null or last_success_at < last_attempt_at);

create or replace function public.crawler_health_track()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (tg_op = 'UPDATE' and new.last_success_at is distinct from old.last_success_at)
     or (tg_op = 'INSERT' and new.last_success_at is not null and new.last_error is null) then
    -- 성공
    new.failure_count := 0;
    new.is_healthy := true;
    new.first_failure_at := null;
  elsif new.last_error is not null
     and (tg_op = 'INSERT' or new.last_attempt_at is distinct from old.last_attempt_at) then
    -- 실패(크롤러는 last_attempt_at + last_error 만 upsert 한다)
    new.failure_count := coalesce(case when tg_op = 'UPDATE' then old.failure_count end, 0) + 1;
    new.is_healthy := false;
    new.first_failure_at := coalesce(case when tg_op = 'UPDATE' then old.first_failure_at end, now());
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists crawler_health_track on public.crawler_health;
create trigger crawler_health_track
  before insert or update on public.crawler_health
  for each row execute function public.crawler_health_track();

-- 2) 조용한 게시판 예외 -------------------------------------------------------
alter table public.sources add column if not exists watch_quiet_ok_until timestamptz;
alter table public.sources add column if not exists watch_note text;

-- 3) 문제 목록 ---------------------------------------------------------------
create or replace function public.crawler_watch_issues()
returns table (source_id uuid, parser_key text, name text, kind text, detail text)
language sql
stable
security definer
set search_path = ''
as $$
  with src as (
    -- 인스타 학생회 계정(cau_ig_*)은 cau_instagram 하나가 모아서 수집하므로 계정별로 보지 않는다.
    select s.* from public.sources s
    where s.is_active and s.parser_key not like 'cau\_ig\_%'
  ),
  agg as (
    select n.source_id, max(n.crawled_at) as last_new, count(*) as total
    from public.notices n
    where n.source_id in (select id from src)
    group by n.source_id
  ),
  gaps as (
    select g.source_id, percentile_cont(0.9) within group (order by g.gap_days) as p90
    from (
      select n.source_id,
             extract(epoch from n.posted_at - lag(n.posted_at) over (partition by n.source_id order by n.posted_at)) / 86400.0 as gap_days
      from public.notices n
      where n.source_id in (select id from src) and n.posted_at > now() - interval '365 days'
    ) g
    where g.gap_days is not null
    group by g.source_id
  )
  -- error: 6시간 넘게 연속 실패
  select s.id, s.parser_key, s.name, 'error',
         format('수집 실패 %s회째(%s부터): %s', h.failure_count,
                to_char(h.first_failure_at at time zone 'Asia/Seoul', 'MM/DD HH24:MI'), left(h.last_error, 160))
  from src s join public.crawler_health h on h.source_id = s.id
  where h.is_healthy = false and h.first_failure_at < now() - interval '6 hours'
  union all
  -- stalled: 26시간 넘게 실행 기록 없음
  select s.id, s.parser_key, s.name, 'stalled',
         case when h.source_id is null then '실행 기록이 없음'
              else format('마지막 실행 %s', to_char(h.last_attempt_at at time zone 'Asia/Seoul', 'MM/DD HH24:MI')) end
  from src s left join public.crawler_health h on h.source_id = s.id
  where s.created_at < now() - interval '1 day'
    and (h.source_id is null or coalesce(h.last_attempt_at, h.last_success_at) < now() - interval '26 hours')
  union all
  -- quiet: 새 글이 평소보다 너무 오래 없음 / 한 번도 수집 안 됨
  select s.id, s.parser_key, s.name, 'quiet',
         case when a.total is null then format('등록(%s) 후 수집된 글이 없음', to_char(s.created_at at time zone 'Asia/Seoul', 'YYYY-MM-DD'))
              else format('새 글 없음 %s일째(평소 간격 %s일 이내)',
                          floor(extract(epoch from now() - a.last_new) / 86400),
                          ceil(coalesce(g.p90, 7))) end
  from src s
  left join agg a on a.source_id = s.id
  left join gaps g on g.source_id = s.id
  where coalesce(s.watch_quiet_ok_until, '-infinity'::timestamptz) < now()
    and (
      (a.total is null and s.created_at < now() - interval '14 days')
      or a.last_new < now() - make_interval(days => least(60, greatest(21, ceil(3 * coalesce(g.p90, 7))))::int)
    );
$$;

revoke all on function public.crawler_watch_issues() from public, anon, authenticated;

-- 4) 알림 상태 ---------------------------------------------------------------
create table if not exists public.crawler_alerts (
  id bigint generated always as identity primary key,
  source_id uuid not null references public.sources(id) on delete cascade,
  kind text not null,
  detail text,
  opened_at timestamptz not null default now(),
  last_notified_at timestamptz,
  closed_at timestamptz
);
create unique index if not exists crawler_alerts_open_uq on public.crawler_alerts (source_id, kind) where closed_at is null;
alter table public.crawler_alerts enable row level security;

-- 5) 관리자 -------------------------------------------------------------------
create table if not exists public.ops_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  note text,
  created_at timestamptz not null default now()
);
alter table public.ops_admins enable row level security;
