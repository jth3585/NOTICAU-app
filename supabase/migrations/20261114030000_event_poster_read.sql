-- 행사 탭 '일정은 원문에서 확인해요' 줄이기: 일시가 포스터에만 적힌 행사 글을 다시 읽는다.
--
-- event_extract 는 본문 글자만 본다(본문이 200자 미만일 때만 llm_classify 의 OCR 정리본을 함께 본다).
-- 그래서 본문 글이 길고 일시는 포스터 이미지에만 있는 공지(특강·토크콘서트·학술제 포스터)는 일정 미정이 됐다.
-- 일시를 못 찾은 행사 글에 한해 포스터를 OCR 로 읽어 한 번 더 추출한다.
--
--  poster_read_at: 포스터 재확인을 마친 시각(일시를 찾았든 못 찾았든 한 번만 시도).

alter table public.notice_events
  add column if not exists poster_read_at timestamptz;

-- 포스터를 읽어 볼 행사: 일시가 비어 있고, 이미지가 있고, 아직 읽어 보지 않은 최근 45일 게시분.
create or replace function public.events_needing_poster_read(lim int default 3)
returns table (notice_id uuid)
language sql
stable
set search_path to 'public'
as $$
  select e.notice_id
  from public.notice_events e
  join public.notices n on n.id = e.notice_id
  where e.kind in ('event', 'giveaway')
    and e.event_start_at is null
    and (e.kind = 'event' or e.event_end_at is null)
    and e.poster_read_at is null
    and coalesce(array_length(n.body_image_urls, 1), 0) > 0
    and n.posted_at > now() - interval '45 days'
  order by n.posted_at desc
  limit lim;
$$;
revoke all on function public.events_needing_poster_read(int) from public, anon, authenticated;
grant execute on function public.events_needing_poster_read(int) to service_role;
