import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';

// 학과별 공지설정: 사용자가 '끈' 게시판(parser_key)만 user_source_prefs에 is_enabled=false로 저장.
// 기본값은 전부 켬(opt-out) → 저장된 disabled 집합만 알면 된다.

export async function fetchDisabledSources(userId?: string): Promise<Set<string>> {
  let uid = userId;
  if (!uid) {
    const { data: { session } } = await supabase.auth.getSession();
    uid = session?.user.id;
  }
  if (!uid) return new Set();
  const { data } = await supabase
    .from('user_source_prefs')
    .select('parser_key')
    .eq('user_id', uid)
    .eq('is_enabled', false);
  return new Set((data ?? []).map((r: any) => r.parser_key));
}

// 설정 화면용 훅: 끈 게시판 집합 + 토글.
export function useDisabledSources() {
  const [disabled, setDisabled] = useState<Set<string>>(new Set());
  const [userId, setUserId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    setUserId(session.user.id);
    setDisabled(await fetchDisabledSources(session.user.id));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const toggle = useCallback(async (parserKey: string, enabled: boolean) => {
    if (!userId) return;
    // 낙관적 갱신
    setDisabled((prev) => {
      const next = new Set(prev);
      if (enabled) next.delete(parserKey); else next.add(parserKey);
      return next;
    });
    const { error } = await supabase.from('user_source_prefs').upsert(
      { user_id: userId, parser_key: parserKey, is_enabled: enabled, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,parser_key' },
    );
    if (error) {
      // 롤백
      setDisabled((prev) => {
        const next = new Set(prev);
        if (enabled) next.add(parserKey); else next.delete(parserKey);
        return next;
      });
      throw error;
    }
  }, [userId]);

  return { disabled, toggle, reload };
}
