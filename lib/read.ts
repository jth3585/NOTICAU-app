import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';

export async function markAsRead(noticeId: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;
  await supabase.from('user_feed_state').upsert(
    { user_id: session.user.id, notice_id: noticeId, read_at: new Date().toISOString() },
    { onConflict: 'user_id,notice_id' },
  );
}

async function fetchReadIds(): Promise<Set<string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return new Set();
  const { data } = await supabase
    .from('user_feed_state')
    .select('notice_id')
    .eq('user_id', session.user.id)
    .not('read_at', 'is', null);
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
