import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import type { Notice, UserKeyword } from './types';

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

type BookmarkRow = { notice_id: string; bookmarked_at: string | null; read_at: string | null };

async function fetchBookmarkRows(): Promise<BookmarkRow[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return [];
  const { data } = await supabase
    .from('user_feed_state')
    .select('notice_id, bookmarked_at, read_at')
    .eq('user_id', session.user.id)
    .not('bookmarked_at', 'is', null)
    .order('bookmarked_at', { ascending: false });
  return (data as BookmarkRow[]) ?? [];
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

export type BookmarkNotice = Notice & { bookmarked_at: string | null; bookmark_read: boolean };

// 전체 북마크를 공지 본문까지 채워 반환 (BookmarkScreen/폴더 화면용).
// bookmarked_at desc 정렬. bookmark_read = read_at != null (폴더 필터/안읽음 표시용).
export function useBookmarkNotices() {
  const [notices, setNotices] = useState<BookmarkNotice[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    if (!loadedOnce) setLoading(true);
    const rows = await fetchBookmarkRows();
    if (rows.length === 0) {
      if (mountedRef.current) { setNotices([]); setLoading(false); setLoadedOnce(true); }
      return;
    }
    const byId = new Map(rows.map((r) => [r.notice_id, r]));
    const { data } = await supabase
      .from('notices')
      .select('*, notice_meta(*), sources(parser_key, name)')
      .in('id', rows.map((r) => r.notice_id));
    const enriched = ((data as Notice[]) ?? [])
      .map((n) => {
        const row = byId.get(n.id);
        return { ...n, bookmarked_at: row?.bookmarked_at ?? null, bookmark_read: row?.read_at != null };
      })
      // bookmarked_at desc (rows 순서 보존)
      .sort((a, b) => (b.bookmarked_at ?? '').localeCompare(a.bookmarked_at ?? ''));
    if (mountedRef.current) { setNotices(enriched); setLoading(false); setLoadedOnce(true); }
  }, [loadedOnce]);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    return () => { mountedRef.current = false; };
  }, [refresh]);

  return { notices, loading, refresh };
}

// 사용자 등록 키워드 목록 훅 (키워드매치 폴더 칩용).
export function useUserKeywords() {
  const [keywords, setKeywords] = useState<UserKeyword[]>([]);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const { data } = await supabase.from('user_keywords').select('*').eq('user_id', session.user.id);
      if (mountedRef.current) setKeywords((data as UserKeyword[]) ?? []);
    })();
    return () => { mountedRef.current = false; };
  }, []);

  return keywords;
}
