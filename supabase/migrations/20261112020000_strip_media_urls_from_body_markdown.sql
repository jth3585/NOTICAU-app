-- AI 정리 본문(notice_meta.body_markdown)에 '## 이미지' / '## 첨부' 섹션과 이미지·첨부 원본 URL이 그대로 들어가는 문제.
-- 앱 상세 화면은 이미지·첨부파일 섹션과 '원문 페이지 열기' 버튼을 따로 보여주므로 본문 속 URL은 중복·노이즈.
--
-- strip_redundant_media(md, imgs, atts):
--   · '## 이미지' 섹션: 공지에 body_image_urls 가 있으면 통째로 제거(라벨 '(카드뉴스 1)' 등은 정보 없음)
--   · 그 밖의 줄: 이 공지의 이미지/첨부 URL 문자열만 지우고, 남는 라벨(파일명 '신청서 양식' 등)은 보존
--     → URL을 지운 뒤 의미 있는 글자가 안 남는 줄은 제거
--   · 내용이 비어버린 ## 섹션 헤더 제거, 연속 빈 줄 정리
--   · 신청폼 등 공지 자체 이미지/첨부가 아닌 일반 링크는 건드리지 않음
-- notice_meta 저장 시 트리거로 자동 적용(llm_classify 프롬프트가 어겨도 안전) + 기존 데이터 1회 정리.

create or replace function public.strip_redundant_media(md text, imgs text[], atts text[])
returns text
language plpgsql
immutable
set search_path to ''
as $$
declare
  l text;
  u text;
  pass1 text[] := '{}';
  out_lines text[] := '{}';
  in_img_section boolean := false;
  had_url boolean;
  rest text;
  urls text[] := coalesce(imgs, '{}') || coalesce(atts, '{}');
  i int;
  j int;
  has_content boolean;
begin
  if md is null then return null; end if;

  -- 1) 이미지 섹션 제거 + 줄 단위 URL 제거
  foreach l in array string_to_array(md, E'\n') loop
    if l ~ '^##\s' then
      in_img_section := (l ~ '^##\s*이미지\s*$' and cardinality(coalesce(imgs, '{}')) > 0);
      if in_img_section then continue; end if;
      pass1 := pass1 || l;
      continue;
    end if;
    if in_img_section then continue; end if;

    had_url := false;
    foreach u in array urls loop
      if length(u) > 10 and position(u in l) > 0 then
        l := replace(l, u, '');
        had_url := true;
      end if;
    end loop;
    if had_url then
      l := regexp_replace(l, '[(<\[]\s*[)>\]]', '', 'g');                 -- URL 빠진 빈 괄호 '()'
      l := regexp_replace(l, '[:：]\s+\(', ' (', 'g');                    -- 'PDF:  (설명)' → 'PDF (설명)'
      l := regexp_replace(l, '[\s:：\-–—|]+$', '');                       -- 꼬리의 ': ' 등
      rest := regexp_replace(l, '^\s*([-*]|\d+\.)?\s*', '');             -- 리스트 기호
      rest := regexp_replace(rest, '\((이미지|카드뉴스|첨부|사진|포스터)\s*\d*\)', '', 'g');
      if rest !~ '[가-힣A-Za-z0-9]' then continue; end if;               -- 남는 정보 없으면 줄 삭제
    end if;
    pass1 := pass1 || l;
  end loop;

  -- 2) 내용이 비어버린 '## ' 섹션 헤더 제거
  i := 1;
  while i <= coalesce(array_length(pass1, 1), 0) loop
    if pass1[i] ~ '^##\s' then
      has_content := false;
      j := i + 1;
      while j <= array_length(pass1, 1) and pass1[j] !~ '^##\s' loop
        if btrim(pass1[j]) <> '' then has_content := true; exit; end if;
        j := j + 1;
      end loop;
      if not has_content then i := i + 1; continue; end if;
    end if;
    out_lines := out_lines || pass1[i];
    i := i + 1;
  end loop;

  return nullif(regexp_replace(btrim(array_to_string(out_lines, E'\n'), E'\n '), E'\n{3,}', E'\n\n', 'g'), '');
end $$;

revoke all on function public.strip_redundant_media(text, text[], text[]) from anon, authenticated;

create or replace function public.notice_meta_strip_media()
returns trigger
language plpgsql
set search_path to ''
as $$
declare v_imgs text[]; v_atts text[];
begin
  if new.body_markdown is null or (new.body_markdown !~ 'https?://' and new.body_markdown !~ '##\s*이미지') then
    return new;
  end if;
  select n.body_image_urls, n.attachment_urls into v_imgs, v_atts from public.notices n where n.id = new.notice_id;
  new.body_markdown := public.strip_redundant_media(new.body_markdown, v_imgs, v_atts);
  return new;
end $$;

drop trigger if exists notice_meta_strip_media on public.notice_meta;
create trigger notice_meta_strip_media
  before insert or update of body_markdown on public.notice_meta
  for each row execute function public.notice_meta_strip_media();

-- 기존 데이터 1회 정리: 실제로 바뀌는 행만 UPDATE
with t as (
  select m.notice_id, public.strip_redundant_media(m.body_markdown, n.body_image_urls, n.attachment_urls) as cleaned
  from public.notice_meta m join public.notices n on n.id = m.notice_id
  where m.body_markdown ~ 'https?://' or m.body_markdown ~ '##\s*이미지'
)
update public.notice_meta m set body_markdown = t.cleaned
from t
where m.notice_id = t.notice_id and m.body_markdown is distinct from t.cleaned;
