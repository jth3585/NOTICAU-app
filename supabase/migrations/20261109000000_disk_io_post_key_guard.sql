-- Disk IO 예산 경고(2026-11) 대응.
--
-- (1) post_key 중복 INSERT 사전 차단
--   크롤러는 content_hash(제목|URL|게시일)로 존재 여부를 확인한 뒤 INSERT한다. 원본 글의 제목/날짜가
--   바뀌면 hash가 달라 "새 글"로 판단 → INSERT → notices_post_key_key 위반(23505)으로 실패.
--   실패해도 heap·TOAST·인덱스 9개(pgroonga 2개 포함)에 이미 기록한 뒤 abort되므로 dead tuple과
--   WAL(FPI)이 쌓인다. 10분 주기 크롤러에서 같은 글이 하루 144회씩, 전체 ~6,000회/일 반복됐다.
--   BEFORE INSERT 트리거에서 같은 post_key가 있으면 동일한 23505를 먼저 던진다 → 크롤러 동작은
--   그대로(skippedDup), 디스크 기록은 0.
--
-- (2) dedup_notices: 새 공지가 없으면 즉시 종료
--   10분마다 temp table 생성(카탈로그 쓰기)+전체 재계산 → 호출당 ~32블록 FPI(468MB WAL/44일).
--   중복 매핑은 notices 신규 적재 시에만 바뀌므로 최근 20분 내 crawled_at이 없으면 skip.
--   하루 1회(04:00~04:09 KST 실행분)는 안전망으로 전체 재계산.

-- post_key 생성 컬럼과 동일한 식(생성 컬럼은 BEFORE 트리거 시점에 아직 계산되지 않음)
create or replace function public.notice_post_key(url text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when url ~ 'www\.cau\.ac\.kr' then 'main:' || substring(url, 'BBS_SEQ=([0-9]+)')
    when url ~ 'biz\.cau\.ac\.kr' then 'biz:' || substring(url, 'bbsIdx=([0-9]+)')
    when url ~ 'bne\.cau\.ac\.kr' then 'bne:' || substring(url, 'idx=([0-9]+)')
    when url ~ 'dormitory\.cau\.ac\.kr' then 'dorms:' || substring(url, 'uid=([0-9]+)')
    when url ~ 'dorm\.cau\.ac\.kr' then 'dorm:' || substring(url, 'uid=([0-9]+)')
    when url ~ 'library\.cau\.ac\.kr' then 'lib:' || substring(url, '([0-9]+)/?$')
    else url
  end
$$;

create or replace function public.notices_reject_dup_post_key()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  k text := public.notice_post_key(new.source_url);
begin
  if k is not null and exists (select 1 from public.notices where post_key = k) then
    raise exception 'duplicate key value violates unique constraint "notices_post_key_key"'
      using errcode = '23505', detail = format('Key (post_key)=(%s) already exists.', k);
  end if;
  return new;
end $$;

drop trigger if exists notices_reject_dup_post_key on public.notices;
create trigger notices_reject_dup_post_key
  before insert on public.notices
  for each row execute function public.notices_reject_dup_post_key();

-- dedup_notices: 신규 적재 없으면 skip (본문 로직은 20260714000000_dedup_diff_only와 동일)
create or replace function public.dedup_notices()
returns void
language plpgsql
set search_path to 'public'
as $function$
begin
  if not exists (select 1 from notices where crawled_at > now() - interval '20 minutes')
     and not (extract(hour from now() at time zone 'Asia/Seoul') = 4
              and extract(minute from now() at time zone 'Asia/Seoul') < 10) then
    return;
  end if;

  -- 대상 매핑 계산(정규화 제목 + ±21일 윈도우). 대표 우선순위: university>service>college>dept.
  create temp table _dedup_target on commit drop as
  with base as (
    select n.id, n.source_id, n.posted_at, n.posted_at::date d,
      case s.scope_type when 'university' then 0 when 'service' then 1 when 'college' then 2 else 3 end as prio,
      lower(regexp_replace(regexp_replace(n.title, '\[[^\]]*\]', '', 'g'), '[^가-힣a-z0-9]', '', 'g')) as k
    from notices n join sources s on s.id = n.source_id
    where n.posted_at is not null
  ),
  filt as (select * from base where length(k) >= 8),
  lagged as (select *, lag(d) over (partition by k order by d, id) as prev_d from filt),
  isl as (
    select *, sum(case when prev_d is null or d - prev_d > 21 then 1 else 0 end)
      over (partition by k order by d, id) as gid
    from lagged
  ),
  grpinfo as (select k, gid, count(distinct source_id) as src_n from isl group by k, gid),
  ranked as (
    select i.id, i.source_id, i.k, i.gid,
      first_value(i.id) over w as rep_id, first_value(i.source_id) over w as rep_src
    from isl i window w as (partition by i.k, i.gid order by i.prio, i.posted_at, i.id)
  )
  select r.id, case when g.src_n > 1 and r.source_id <> r.rep_src then r.rep_id else null end as new_dup
  from ranked r join grpinfo g on g.k = r.k and g.gid = r.gid;

  -- (1) 바뀐 행만 duplicate_of 갱신
  update notices n set duplicate_of = t.new_dup
    from _dedup_target t
    where n.id = t.id and n.duplicate_of is distinct from t.new_dup;

  -- (2) 대상에 없는데 아직 표시된 행(과거 잔여) 정리
  update notices n set duplicate_of = null
    where n.duplicate_of is not null
      and not exists (select 1 from _dedup_target t where t.id = n.id);

  -- (3) 대표행 dup_count/keys 갱신(바뀐 것만)
  with agg as (
    select d.duplicate_of as rep_id, array_agg(distinct s.parser_key) as keys
    from notices d join sources s on s.id = d.source_id
    where d.duplicate_of is not null group by d.duplicate_of
  )
  update notices rep set dup_source_keys = agg.keys, dup_count = coalesce(array_length(agg.keys, 1), 0)
    from agg where rep.id = agg.rep_id and rep.dup_source_keys is distinct from agg.keys;

  -- (4) 더 이상 대표가 아닌 행의 dup_count/keys 클리어
  update notices n set dup_count = 0, dup_source_keys = null
    where (n.dup_count <> 0 or n.dup_source_keys is not null)
      and not exists (select 1 from notices d where d.duplicate_of = n.id);
end $function$;
