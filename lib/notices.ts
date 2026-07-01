import { supabase } from './supabase';
import type { Notice } from './types';

// 카드/리스트 전용 초경량 select. body_text/body_image_urls/attachment_urls(무거움)와
// notice_meta.body_markdown(LLM 재구성 본문)을 제외해 목록 페이로드를 대폭 줄인다
// (300행 기준 ~2.3MB→0.16MB). 카드 렌더엔 이 필드들이 필요 없고, 상세 화면은 진입 시
// id로 본문을 단건 재조회(fetchNoticeById)해 채운다.
// ※ 홈/디지스트의 키워드 매칭·점수는 body_text가 필요하지만, 대상(최근 24h/전체)에 한해
//    'id, body_text'만 별도로 소량 로드해 붙인다(각 훅 참고).
export const NOTICE_CARD_SELECT =
  'id, source_id, source_category, title, source_url, author, posted_at, is_pinned, crawled_at, duplicate_of, dup_count, dup_source_keys, notice_meta(notice_id, topic, action, apply_start_at, deadline_at, target_grades, target_depts, target_campuses, target_enrollment_status, targets_freshmen, excludes_undergrad), sources(parser_key, name, campus, owner_unit)';

// 단일 공지를 상세화면에 필요한 형태(meta + source 조인)로 전체 조회 (body_markdown 포함).
// 알림 딥링크처럼 id만 있을 때 사용.
export async function fetchNoticeById(id: string): Promise<Notice | null> {
  const { data } = await supabase
    .from('notices')
    .select('*, notice_meta(*), sources(parser_key, name, campus)')
    .eq('id', id)
    .maybeSingle();
  return (data as Notice) ?? null;
}
