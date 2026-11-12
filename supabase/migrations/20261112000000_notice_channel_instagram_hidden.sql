-- 학생회 Instagram 공지(cau_ig_*)는 수집·분류는 하되 공지탭/홈/검색/푸시엔 노출하지 않는다.
-- (추후 '내 학과' 탭에서 학과 게시판 공지 + 인스타 공지를 모아 보여줄 예정 → 그때 전용 RPC/정책 추가)
--
-- notices.channel: 'board'(게시판 크롤러) | 'instagram'(cau_ig_*). INSERT 트리거가 소스로 자동 지정.

alter table public.notices
  add column if not exists channel text not null default 'board'
  check (channel in ('board', 'instagram'));

create or replace function public.notices_set_channel()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if exists (select 1 from sources s where s.id = new.source_id and s.parser_key like 'cau\_ig\_%') then
    new.channel := 'instagram';
  end if;
  return new;
end $$;

drop trigger if exists notices_set_channel on public.notices;
create trigger notices_set_channel
  before insert on public.notices
  for each row execute function public.notices_set_channel();

-- 기존 인스타 공지 백필
update public.notices n set channel = 'instagram'
  from public.sources s
  where s.id = n.source_id and s.parser_key like 'cau\_ig\_%' and n.channel <> 'instagram';

-- 공개 읽기: 게시판 공지만 (앱의 모든 notices 조회·search_notices(invoker)에 일괄 적용)
drop policy if exists "public read notices" on public.notices;
create policy "public read notices" on public.notices
  for select using (channel = 'board');

-- dedup: 인스타 공지는 교차출처 중복 판정에서 제외.
-- (안 그러면 단과대 인스타(prio 2)가 대표가 되어 같은 제목의 학과 게시판 공지(prio 3)가 duplicate로 숨겨짐)
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

  create temp table _dedup_target on commit drop as
  with base as (
    select n.id, n.source_id, n.posted_at, n.posted_at::date d,
      case s.scope_type when 'university' then 0 when 'service' then 1 when 'college' then 2 else 3 end as prio,
      lower(regexp_replace(regexp_replace(n.title, '\[[^\]]*\]', '', 'g'), '[^가-힣a-z0-9]', '', 'g')) as k
    from notices n join sources s on s.id = n.source_id
    where n.posted_at is not null
      and n.channel = 'board'
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

  update notices n set duplicate_of = t.new_dup
    from _dedup_target t
    where n.id = t.id and n.duplicate_of is distinct from t.new_dup;

  update notices n set duplicate_of = null
    where n.duplicate_of is not null
      and not exists (select 1 from _dedup_target t where t.id = n.id);

  with agg as (
    select d.duplicate_of as rep_id, array_agg(distinct s.parser_key) as keys
    from notices d join sources s on s.id = d.source_id
    where d.duplicate_of is not null group by d.duplicate_of
  )
  update notices rep set dup_source_keys = agg.keys, dup_count = coalesce(array_length(agg.keys, 1), 0)
    from agg where rep.id = agg.rep_id and rep.dup_source_keys is distinct from agg.keys;

  update notices n set dup_count = 0, dup_source_keys = null
    where (n.dup_count <> 0 or n.dup_source_keys is not null)
      and not exists (select 1 from notices d where d.duplicate_of = n.id);
end $function$;
