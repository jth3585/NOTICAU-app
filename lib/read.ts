import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';

// source: 어느 화면에서 열었는지(홈 큐레이션/새공지/키워드/전체공지/검색/북마크/푸시 등).
// 큐레이션 등 surface별 참여도 분석용. 미지정 시 기존 값 보존(upsert가 준 컬럼만 갱신).
export async function markAsRead(noticeId: string, source?: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;
  const row: Record<string, unknown> = {
    user_id: session.user.id, notice_id: noticeId, read_at: new Date().toISOString(),
  };
  if (source) row.read_source = source;
  await supabase.from('user_feed_state').upsert(row, { onConflict: 'user_id,notice_id' });
}

export async function fetchReadIds(): Promise<Set<string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return new Set();
  // 읽음 상태는 무한 누적되므로 최근 것만 로드한다. 피드(홈 24h·목록 최신순)와 다이제스트는
  // 모두 최신 공지 기준이라, 오래전 읽은 글이 피드에 다시 뜰 일이 없어 안전하다.
  const since = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString(); // 최근 120일
  const { data } = await supabase
    .from('user_feed_state')
    .select('notice_id')
    .eq('user_id', session.user.id)
    .not('read_at', 'is', null)
    .gte('read_at', since)
    .order('read_at', { ascending: false })
    .limit(5000);
  return new Set(data?.map((r: any) => r.notice_id as string) ?? []);
}

export function useReadSet() {
  const [readSet, setReadSet] = useState<Set<string>>(new Set());
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    const set = await fetchReadIds();
    if (mountedRef.current) setReadSet(new Set(set));
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    return () => { mountedRef.current = false; };
  }, [refresh]);

  const isRead = useCallback((id: string) => readSet.has(id), [readSet]);

  return { readSet, refresh, isRead };
}
