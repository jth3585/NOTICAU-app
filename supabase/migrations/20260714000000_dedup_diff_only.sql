-- dedup_notices()를 diff-only로 재작성 — Disk IO 급증 해소.
--
-- 기존: 매 실행마다 표시된 중복행을 전부 null로 리셋 후 다시 표시(항상 ~2×중복수 만큼 UPDATE).
--   llm_classify가 5분마다 이 함수를 호출 → notices 테이블에 수십만 write/일 → WAL·autovacuum IO 폭증
--   (Supabase Disk IO Budget 경고 발생).
-- 변경: 목표 duplicate_of를 계산해 실제로 바뀐 행만 UPDATE(`is distinct from`). 평상시 write 0.
--   + llm_classify의 dedup 호출 제거, dedup은 별도 cron '*/10 * * * *'로 수행.

create or replace function dedup_notices() returns void language plpgsql as $$
begin
  -- 대상 매핑 계산(정규화 제목 + ±21일 윈도우). 대표 우선순위: university>service>college>dept, 동률 시 게시 빠른 순.
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
end $$;

-- 스케줄 재조정 (참고): select cron.schedule('dedup_notices', '*/10 * * * *', $$select dedup_notices();$$);
