import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabase';
import type { Notice, Profile, UserKeyword } from './types';
import { metaOf, sourceOf } from './format';
import { isMismatch, calculateMatchScore } from './matching';
import { fetchReadIds } from './read';

const CACHE_KEY = 'noticau:digest_today';
type DigestCache = { date: string; notice_ids: string[] };

async function loadCache(): Promise<DigestCache | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

async function saveCache(ids: string[]): Promise<void> {
  const date = new Date().toISOString().slice(0, 10);
  await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ date, notice_ids: ids }));
}

async function appendCache(newIds: string[]): Promise<void> {
  const cached = await loadCache();
  const existing = cached?.notice_ids ?? [];
  const merged = [...existing, ...newIds.filter(id => !existing.includes(id))];
  const date = new Date().toISOString().slice(0, 10);
  await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ date, notice_ids: merged }));
}

// 매칭 점수 기반 notice ID 목록 계산 (excludeIds 제외)
async function computeDigestIds(excludeIds: string[], limit: number): Promise<string[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return [];

  const [profileRes, keywordsRes, prefsRes, readRes, noticesRes] = await Promise.all([
    supabase.from('profiles').select('*').eq('user_id', session.user.id).maybeSingle(),
    supabase.from('user_keywords').select('*').eq('user_id', session.user.id),
    supabase.from('user_category_prefs').select('topic,is_enabled').eq('user_id', session.user.id),
    supabase.from('user_feed_state').select('notice_id').eq('user_id', session.user.id).not('read_at', 'is', null),
    supabase.from('notices').select('*, notice_meta(*), sources(parser_key, name)').order('posted_at', { ascending: false }).limit(300),
  ]);

  const profile = profileRes.data as Profile | null;
  if (!profile) return [];

  const keywords = (keywordsRes.data ?? []) as UserKeyword[];
  const disabledTopics = new Set<string>(
    ((prefsRes.data ?? []) as any[]).filter(p => !p.is_enabled).map(p => p.topic),
  );
  const readIds = new Set<string>(((readRes.data ?? []) as any[]).map((r: any) => r.notice_id));
  const notices = (noticesRes.data ?? []) as Notice[];
  const excludeSet = new Set(excludeIds);

  const scored = notices
    .filter(n => !excludeSet.has(n.id))
    .filter(n => !isMismatch(n, metaOf(n), profile, disabledTopics, readIds))
    .map(n => ({
      id: n.id,
      score: calculateMatchScore(n, metaOf(n), profile, keywords, sourceOf(n)),
    }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(s => s.id);
}

async function fetchNoticesByIds(ids: string[]): Promise<Notice[]> {
  if (ids.length === 0) return [];
  const { data } = await supabase
    .from('notices')
    .select('*, notice_meta(*), sources(parser_key, name)')
    .in('id', ids);
  // ids 순서 유지
  const map = new Map((data ?? []).map((n: any) => [n.id, n]));
  return ids.map(id => map.get(id)).filter(Boolean) as Notice[];
}

export function useDigest() {
  const [cacheIds, setCacheIds] = useState<string[]>([]);
  const [allNotices, setAllNotices] = useState<Notice[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const mounted = useRef(true);

  const syncReadIds = useCallback(async () => {
    const set = await fetchReadIds();
    if (mounted.current) setReadIds(set);
  }, []);

  const initialize = useCallback(async () => {
    setLoading(true);
    const today = new Date().toISOString().slice(0, 10);
    const cached = await loadCache();

    let ids: string[];
    if (cached && cached.date === today) {
      ids = cached.notice_ids;
    } else {
      ids = await computeDigestIds([], 5);
      await saveCache(ids);
    }

    const [notices, readSet] = await Promise.all([
      fetchNoticesByIds(ids),
      fetchReadIds(),
    ]);

    if (mounted.current) {
      setCacheIds(ids);
      setAllNotices(notices);
      setReadIds(readSet);
      setLoading(false);
    }
  }, []);

  // pull-to-refresh: 읽음 상태만 재동기
  const refresh = useCallback(async () => {
    await syncReadIds();
  }, [syncReadIds]);

  // 추천 더보기: 기존 캐시 제외 + 5개 추가
  const loadMore = useCallback(async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    const newIds = await computeDigestIds(cacheIds, 5);
    if (newIds.length > 0) {
      await appendCache(newIds);
      const newNotices = await fetchNoticesByIds(newIds);
      if (mounted.current) {
        setCacheIds(prev => [...prev, ...newIds]);
        setAllNotices(prev => [...prev, ...newNotices]);
      }
    }
    if (mounted.current) setLoadingMore(false);
  }, [cacheIds, loadingMore]);

  useEffect(() => {
    mounted.current = true;
    initialize();
    return () => { mounted.current = false; };
  }, [initialize]);

  // visible = 캐시된 공지 중 아직 안 읽은 것
  const visible = useMemo(
    () => allNotices.filter(n => !readIds.has(n.id)),
    [allNotices, readIds],
  );

  // 오늘의 다이제스트를 모두 읽었을 때
  const allSeen = !loading && cacheIds.length > 0 && visible.length === 0;

  return { notices: visible, loading, loadingMore, allSeen, refresh, loadMore, syncReadIds };
}
