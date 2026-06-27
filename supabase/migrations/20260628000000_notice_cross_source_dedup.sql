-- 교차출처 중복 공지 처리: 본교/단과대 공지가 여러 학과 게시판에 재게시될 때
-- 대표 1건만 피드에 노출하고 나머지는 duplicate_of로 묶는다.
-- (저장은 유지 → 데이터 보존 + "외 N곳에도 게시" 표시 가능)
--
-- 대표 우선순위: university(본교) > service(산학협력단 등) > college(단과대) > dept(학과),
-- 동률 시 게시 빠른 순. 같은 출처의 반복 공지(주말 당직 등)는 묶지 않음(distinct source ≥ 2일 때만).

alter table notices add column if not exists duplicate_of uuid references notices(id) on delete set null;
alter table notices add column if not exists dup_count int not null default 0;
alter table notices add column if not exists dup_source_keys text[];

create index if not exists notices_not_duplicate_posted_idx
  on notices (posted_at desc) where duplicate_of is null;
create index if not exists notices_duplicate_of_idx on notices (duplicate_of);

-- 정규화 제목(대괄호 태그·특수문자 제거) + ±21일 윈도우(gaps-and-islands)로 그룹화.
-- idempotent: 매 실행마다 전체 재계산. pg_cron으로 매시 25분 실행.
create or replace function dedup_notices() returns void language plpgsql as $$
begin
  update notices set duplicate_of = null, dup_count = 0, dup_source_keys = null
    where duplicate_of is not null or dup_count <> 0 or dup_source_keys is not null;

  with base as (
    select n.id, n.source_id, n.posted_at, n.posted_at::date d,
      case s.scope_type when 'university' then 0 when 'service' then 1 when 'college' then 2 else 3 end as prio,
      lower(regexp_replace(regexp_replace(n.title, '\[[^\]]*\]', '', 'g'), '[^가-힣a-z0-9]', '', 'g')) as k
    from notices n join sources s on s.id = n.source_id
    where n.posted_at is not null
  ),
  filt as (select * from base where length(k) >= 8),
  lagged as (
    select *, lag(d) over (partition by k order by d, id) as prev_d from filt
  ),
  isl as (
    select *, sum(case when prev_d is null or d - prev_d > 21 then 1 else 0 end)
      over (partition by k order by d, id) as gid
    from lagged
  ),
  grpinfo as (
    select k, gid, count(distinct source_id) as src_n from isl group by k, gid
  ),
  ranked as (
    select i.id, i.source_id, i.k, i.gid,
      first_value(i.id) over w as rep_id,
      first_value(i.source_id) over w as rep_src
    from isl i
    window w as (partition by i.k, i.gid order by i.prio, i.posted_at, i.id)
  )
  update notices n set duplicate_of = r.rep_id
    from ranked r join grpinfo g on g.k = r.k and g.gid = r.gid
    where n.id = r.id and g.src_n > 1 and r.source_id <> r.rep_src;

  update notices rep set dup_source_keys = sub.keys, dup_count = coalesce(array_length(sub.keys, 1), 0)
    from (
      select d.duplicate_of as rep_id, array_agg(distinct s.parser_key) as keys
      from notices d join sources s on s.id = d.source_id
      where d.duplicate_of is not null
      group by d.duplicate_of
    ) sub
    where rep.id = sub.rep_id;
end $$;

-- 스케줄 (참고): select cron.schedule('dedup_notices', '25 * * * *', $$select dedup_notices();$$);
