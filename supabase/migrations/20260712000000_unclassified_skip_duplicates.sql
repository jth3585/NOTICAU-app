-- 분류 큐에서 교차출처 중복본 제외: 대표본(duplicate_of is null)만 LLM 분류 대상.
-- 중복본은 피드·푸시에서 이미 제외되므로 분류할 필요가 없다 → 분류 토큰 낭비 차단(~17%).
-- 순서 보장: llm_classify가 fetch 직전 dedup_notices()를 호출해 방금 크롤된 중복본을
-- 먼저 표시하므로, 이 필터가 신규 유입분에도 실효성을 갖는다.

create or replace function public.notices_unclassified(lim integer default 10)
returns setof notices
language sql
stable
set search_path to 'public'
as $function$
  select n.*
  from public.notices n
  left join public.notice_meta m on m.notice_id = n.id
  where m.notice_id is null
    and n.classify_attempts < 3   -- 3회 실패 시 영구 포기 (비용 보호)
    and n.duplicate_of is null     -- 교차출처 중복본은 분류 제외 (대표본만)
  order by n.crawled_at desc
  limit lim;
$function$;
