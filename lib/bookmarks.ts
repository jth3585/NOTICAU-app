import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabase';
import type { Notice, UserKeyword } from './types';
import { NOTICE_CARD_SELECT } from './notices';
import { logEvent } from './events';
import { matchKeywordRow } from './matching';

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

type BookmarkRow = {
  notice_id: string;
  bookmarked_at: string | null;
  read_at: string | null;
  bookmark_folder_id: string | null;
};

async function fetchBookmarkRows(): Promise<BookmarkRow[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return [];
  const { data } = await supabase
    .from('user_feed_state')
    .select('notice_id, bookmarked_at, read_at, bookmark_folder_id')
    .eq('user_id', session.user.id)
    .not('bookmarked_at', 'is', null)
    .order('bookmarked_at', { ascending: false });
  return (data as BookmarkRow[]) ?? [];
}

export async function addBookmark(noticeId: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;
  await supabase.from('user_feed_state').upsert(
    { user_id: session.user.id, notice_id: noticeId, bookmarked_at: new Date().toISOString() },
    { onConflict: 'user_id,notice_id' },
  );
  logEvent('bookmark_add', { noticeId });
}

export async function removeBookmark(noticeId: string): Promise<void> {
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

// 북마크된 notice_id Set 훅 (리스트에서 "이미 북마크됨" 판별용). useReadSet과 동형.
export function useBookmarkSet() {
  const [bookmarkSet, setBookmarkSet] = useState<Set<string>>(new Set());
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    const ids = await fetchBookmarkIds();
    if (mountedRef.current) setBookmarkSet(new Set(ids));
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    return () => { mountedRef.current = false; };
  }, [refresh]);

  // 낙관적 로컬 추가 (서버 반영 후 refresh로 정합성 보정).
  const markBookmarked = useCallback((id: string) => {
    setBookmarkSet((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const isBookmarked = useCallback((id: string) => bookmarkSet.has(id), [bookmarkSet]);

  return { bookmarkSet, isBookmarked, markBookmarked, refresh };
}

export type BookmarkNotice = Notice & {
  bookmarked_at: string | null;
  bookmark_read: boolean;
  bookmark_folder_id: string | null;
};

// 전체 북마크를 공지 본문까지 채워 반환 (BookmarkScreen/폴더 화면용).
// bookmarked_at desc 정렬. bookmark_read = read_at != null (폴더 필터/안읽음 표시용).
export function useBookmarkNotices() {
  const [notices, setNotices] = useState<BookmarkNotice[]>([]);
  const [loading, setLoading] = useState(true);
  // ref 로 둔다: state 면 첫 로드가 끝나며 refresh 가 새로 만들어져 마운트 효과·포커스 효과가 한 번 더 돈다.
  const loadedOnce = useRef(false);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    if (!loadedOnce.current) setLoading(true);
    // throw 시에도 스켈레톤에 갇히지 않도록 finally에서 로딩/loadedOnce 해제.
    try {
      const rows = await fetchBookmarkRows();
      if (rows.length === 0) {
        if (mountedRef.current) setNotices([]);
        return;
      }
      const byId = new Map(rows.map((r) => [r.notice_id, r]));
      const { data } = await supabase
        .from('notices')
        .select(NOTICE_CARD_SELECT)
        .in('id', rows.map((r) => r.notice_id));
      const found = (data as Notice[]) ?? [];
      // 행사 탭에서 북마크한 인스타 공지는 notices RLS(channel='board')에 막혀 위 조회에 안 잡힌다.
      // 빠진 id만 notice_by_id RPC로 보충(보통 0~몇 건).
      const foundIds = new Set(found.map((n) => n.id));
      const missing = rows.map((r) => r.notice_id).filter((id) => !foundIds.has(id));
      const extra = (await Promise.all(
        missing.slice(0, 30).map(async (id) => (await supabase.rpc('notice_by_id', { p_id: id })).data as Notice | null),
      )).filter((n): n is Notice => !!n);
      const enriched = [...found, ...extra]
        .map((n) => {
          const row = byId.get(n.id);
          return {
            ...n,
            bookmarked_at: row?.bookmarked_at ?? null,
            bookmark_read: row?.read_at != null,
            bookmark_folder_id: row?.bookmark_folder_id ?? null,
          };
        })
        // bookmarked_at desc (rows 순서 보존)
        .sort((a, b) => (b.bookmarked_at ?? '').localeCompare(a.bookmarked_at ?? ''));
      if (mountedRef.current) setNotices(enriched);
    } catch (e) {
      console.error('[bookmarks] refresh failed', e);
    } finally {
      loadedOnce.current = true;
      if (mountedRef.current) setLoading(false);
    }
  }, []);

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
      const { data } = await supabase.from('user_keywords').select('id, keyword, title_only').eq('user_id', session.user.id);
      if (mountedRef.current) setKeywords((data as UserKeyword[]) ?? []);
    })();
    return () => { mountedRef.current = false; };
  }, []);

  return keywords;
}

// 키워드매치 폴더용. 북마크 목록은 경량 select(본문 제외)라 '제목+본문' 키워드가 본문에만 있는 글을 놓친다.
// → 본문까지 보는 키워드가 있을 때만, 제목으로는 안 걸린 북마크의 본문을 받아 붙여 돌려준다.
export function useWithKeywordBodies<T extends Notice>(notices: T[], keywords: UserKeyword[]): T[] {
  const [bodies, setBodies] = useState<Map<string, string | null>>(new Map());
  const needsBody = keywords.some((k) => !k.title_only);
  const missingKey = useMemo(() => {
    if (!needsBody) return '';
    return notices
      .filter((n) => n.body_text == null && !bodies.has(n.id)
        && !keywords.some((k) => matchKeywordRow(n.title ?? '', '', k)))
      .map((n) => n.id)
      .join(',');
  }, [needsBody, notices, keywords, bodies]);

  useEffect(() => {
    if (!missingKey) return;
    let alive = true;
    (async () => {
      const ids = missingKey.split(',');
      const got = new Map<string, string | null>();
      // .in() 필터는 URL 에 실리므로 100개씩 나눠 받는다.
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100);
        const { data, error } = await supabase.from('notices').select('id, body_text').in('id', chunk);
        if (error) return; // 다음 렌더/진입에서 다시 시도
        const rows = (data ?? []) as { id: string; body_text: string | null }[];
        rows.forEach((r) => got.set(r.id, r.body_text));
        // 테이블 조회에 안 잡힌 것(인스타 공지 등)은 본문 없음으로 기록해 다시 요청하지 않는다.
        chunk.forEach((id) => { if (!got.has(id)) got.set(id, null); });
      }
      if (alive) setBodies((prev) => new Map([...prev, ...got]));
    })();
    return () => { alive = false; };
  }, [missingKey]);

  return useMemo(() => (bodies.size === 0 ? notices : notices.map((n) => {
    const b = bodies.get(n.id);
    return b != null && n.body_text == null ? { ...n, body_text: b } : n;
  })), [notices, bodies]);
}
