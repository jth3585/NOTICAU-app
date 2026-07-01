import { supabase } from './supabase';

// 통합 사용자 행동 이벤트 로깅. 분석 전용(append-only) — 실패해도 UX에 영향 없게 무시.
// type 예: 'notice_open' | 'calendar_add' | 'bookmark_add' | 'share' | 'search'
// meta 예: { surface: 'home_curation' } | { query: '장학' }
export async function logEvent(
  type: string,
  opts?: { noticeId?: string | null; meta?: Record<string, unknown> },
): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    await supabase.from('user_events').insert({
      user_id: session.user.id,
      type,
      notice_id: opts?.noticeId ?? null,
      meta: opts?.meta ?? null,
    });
  } catch { /* 분석 로깅 실패는 무시 */ }
}
