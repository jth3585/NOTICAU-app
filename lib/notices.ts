import { supabase } from './supabase';
import type { Notice } from './types';

// 목록/피드용 select. 무거운 notice_meta.body_markdown(LLM 재구성 본문 전체)과
// 앱에서 안 쓰는 메타 필드(summary_*, has_image_content, llm_*)를 제외해 페이로드를 줄인다.
// body_markdown은 상세 화면에서만 필요하므로 거기서 지연 로드한다.
export const NOTICE_LIST_SELECT =
  '*, notice_meta(notice_id, topic, action, apply_start_at, deadline_at, target_grades, target_depts, target_campuses, target_enrollment_status, targets_freshmen, excludes_undergrad), sources(parser_key, name, campus, owner_unit)';

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
