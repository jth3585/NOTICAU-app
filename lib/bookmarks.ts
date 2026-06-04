import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';

const KEY = 'noticau:bookmarks';

async function readIds(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

async function writeIds(ids: string[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(ids));
}

// 단일 공지 북마크 상태 훅. optimistic update.
export function useBookmark(noticeId: string) {
  const [bookmarked, setBookmarked] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    readIds().then((ids) => {
      if (alive) {
        setBookmarked(ids.includes(noticeId));
        setLoading(false);
      }
    });
    return () => { alive = false; };
  }, [noticeId]);

  const toggle = useCallback(async () => {
    const next = !bookmarked;
    setBookmarked(next); // optimistic
    const ids = await readIds();
    const updated = next
      ? ids.includes(noticeId) ? ids : [...ids, noticeId]
      : ids.filter((id) => id !== noticeId);
    await writeIds(updated);
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
    const ids = await readIds();
    if (mountedRef.current) {
      setBookmarkIds(ids);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    return () => { mountedRef.current = false; };
  }, [refresh]);

  return { bookmarkIds, loading, refresh };
}
