import { supabase } from './supabase';
import type { Notice } from './types';

// 단일 공지를 상세화면에 필요한 형태(meta + source 조인)로 조회.
// 알림 딥링크처럼 id만 있을 때 사용.
export async function fetchNoticeById(id: string): Promise<Notice | null> {
  const { data } = await supabase
    .from('notices')
    .select('*, notice_meta(*), sources(parser_key, name)')
    .eq('id', id)
    .maybeSingle();
  return (data as Notice) ?? null;
}
