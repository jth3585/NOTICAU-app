import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';

async function fetchBookmarkIds(): Promise<string[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return [];
  const { data } = await supabase
    .from('user_feed_state')
    .select('notice_id')
    .eq('user_id', session.user.id)
    .not('bookmarked_at', 'is', null);
  return data?.map((r: any) => r.notice_id as string) ?? [];
}

async function addBookmark(noticeId: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;
  await supabase.from('user_feed_state').upsert(
    { user_id: session.user.id, notice_id: noticeId, bookmarked_at: new Date().toISOString() },
    { onConflict: 'user_id,notice_id' },
  );
}

async function removeBookmark(noticeId: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;
  await supabase
    .from('user_feed_state')
    .update({ bookmarked_at: null })
    .eq('user_id', session.user.id)
    .eq('notice_id', noticeId);
}

// 단일 공지 북마크 상태 훅. optimistic update.
export function useBookmark(noticeId: string) {
  const [bookmarked, setBookmarked] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetchBookmarkIds().then((ids) => {
      if (alive) { setBookmarked(ids.includes(noticeId)); setLoading(false); }
    });
    return () => { alive = false; };
  }, [noticeId]);

  const toggle = useCallback(async () => {
    const next = !bookmarked;
    setBookmarked(next); // optimistic
    if (next) await addBookmark(noticeId);
    else await removeBookmark(noticeId);
  }, [bookmarked, noticeId]);

  return { bookmarked, toggle, loading };
}

// 전체 북마크 ID 목록 훅 (BookmarkScreen용).
export function useBookmarkList() {
  const [bookmarkIds, setBookmarkIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const ids = await fetchBookmarkIds();
    if (mountedRef.current) { setBookmarkIds(ids); setLoading(false); }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    return () => { mountedRef.current = false; };
  }, [refresh]);

  return { bookmarkIds, loading, refresh };
}
