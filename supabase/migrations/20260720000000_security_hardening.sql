-- 보안 하드닝 (2026-07-20, Supabase security advisor 대응)
--
-- 발견: notices_full이 SECURITY DEFINER 뷰(ERROR), search_notices/dedup_notices/
-- tg_set_updated_at의 search_path 미고정(WARN), popular_keywords가 anon 실행 가능한
-- SECURITY DEFINER로 p_min=1 호출 시 전체 사용자 키워드 덤프 가능(프라이버시 누출),
-- 내부 함수(dedup/unclassified)가 REST rpc로 호출 가능(DoS 벡터), user_events에
-- DELETE 정책이 없어 탈퇴 시 행동로그 잔존.

-- 1) notices_full: SECURITY DEFINER 뷰 → invoker (노출 데이터는 어차피 public-read지만 원칙 준수)
alter view public.notices_full set (security_invoker = on);

-- 2) search_notices: definer 불필요(notices는 public-read) → invoker + search_path 고정
alter function public.search_notices(text) security invoker set search_path = public;

-- 3) 내부 함수 search_path 고정
alter function public.dedup_notices() set search_path = public;
alter function public.tg_set_updated_at() set search_path = public;

-- 4) 내부 함수는 API(rpc) 호출 차단 — cron/서비스롤 전용
revoke execute on function public.dedup_notices() from public, anon, authenticated;
grant execute on function public.dedup_notices() to service_role;
revoke execute on function public.notices_unclassified(integer) from public, anon, authenticated;
grant execute on function public.notices_unclassified(integer) to service_role;

-- 5) popular_keywords: p_min을 함수 내부에서 3 이상으로 강제 + limit 상한 50 + anon 차단
create or replace function public.popular_keywords(p_limit integer default 8, p_min integer default 3)
returns table(keyword text, cnt bigint)
language sql security definer
set search_path to 'public'
as $$
  select keyword, count(distinct user_id) as cnt
  from public.user_keywords
  where char_length(btrim(keyword)) between 2 and 12
  group by keyword
  having count(distinct user_id) >= greatest(p_min, 3)
  order by cnt desc, keyword
  limit least(greatest(p_limit, 0), 50)
$$;
revoke execute on function public.popular_keywords(integer, integer) from anon;

-- 6) user_events: 본인 행 삭제 정책 추가(탈퇴 시 행동로그 삭제 가능하게 — lib/auth.ts deleteAccount와 세트)
create policy "delete own events" on public.user_events for delete using (auth.uid() = user_id);
