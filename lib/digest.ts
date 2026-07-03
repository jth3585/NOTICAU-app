import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabase';
import type { Notice, NoticeMeta, Profile, UserKeyword } from './types';
import { metaOf, sourceOf } from './format';
import { isMismatch, calculateMatchScore } from './matching';
import { fetchReadIds } from './read';
import { NOTICE_CARD_SELECT } from './notices';
import { fetchDisabledSources } from './sourcePrefs';

// actionable인데 마감일이 지난 공지는 디지스트에서 제외 (이미 신청 종료 → 무의미).
function isExpiredActionable(meta: NoticeMeta | null): boolean {
  return !!meta && meta.action === 'actionable' && !!meta.deadline_at
    && new Date(meta.deadline_at).getTime() < Date.now();
}

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
    supabase.from('user_keywords').select('keyword, title_only').eq('user_id', session.user.id),
    supabase.from('user_category_prefs').select('topic,is_enabled').eq('user_id', session.user.id),
    supabase.from('user_feed_state').select('notice_id').eq('user_id', session.user.id).not('read_at', 'is', null),
    supabase.from('notices').select(NOTICE_CARD_SELECT).order('posted_at', { ascending: false }).limit(300),
  ]);

  const profile = profileRes.data as Profile | null;
  if (!profile) return [];

  const keywords = (keywordsRes.data ?? []) as UserKeyword[];
  const disabledTopics = new Set<string>(
    ((prefsRes.data ?? []) as any[]).filter(p => !p.is_enabled).map(p => p.topic),
  );
  const readIds = new Set<string>(((readRes.data ?? []) as any[]).map((r: any) => r.notice_id));
  const disabledSources = await fetchDisabledSources(session.user.id);
  const notices = (noticesRes.data ?? []) as Notice[];
  const excludeSet = new Set(excludeIds);

  // 스코어링의 키워드 항목만 body_text가 필요 → 키워드가 있을 때만 본문을 별도 로드해 채운다.
  // (키워드 미등록 사용자는 목록 경량 select 그대로 → 본문 페이로드 0.)
  if (keywords.length > 0) {
    const ids = notices.map((n) => n.id);
    if (ids.length > 0) {
      const { data: bodies } = await supabase.from('notices').select('id, body_text').in('id', ids);
      const bmap = new Map(((bodies ?? []) as any[]).map((b) => [b.id, b.body_text]));
      notices.forEach((n) => { if (bmap.has(n.id)) (n as any).body_text = bmap.get(n.id); });
    }
  }

  const scored = notices
    .filter(n => !excludeSet.has(n.id))
    .filter(n => !isMismatch(n, metaOf(n), profile, disabledTopics, readIds, disabledSources))
    .filter(n => !isExpiredActionable(metaOf(n)))
    .map(n => ({
      id: n.id,
      topic: metaOf(n)?.topic ?? null,
      score: calculateMatchScore(n, metaOf(n), profile, keywords, sourceOf(n)),
    }));

  scored.sort((a, b) => b.score - a.score);

  // 1·2번째 추천은 서로 다른 카테고리로. 2번째 자리엔 1번째와 다른 topic을 우선 배치하고,
  // 나머지는 점수 순으로 채운다(다른 카테고리가 없으면 그대로 점수 순).
  const picked: typeof scored = [];
  for (const s of scored) {
    if (picked.length === 1 && s.topic && picked[0].topic && s.topic === picked[0].topic) continue;
    picked.push(s);
    if (picked.length >= limit) break;
  }
  if (picked.length < limit) {
    const chosen = new Set(picked.map(s => s.id));
    for (const s of scored) {
      if (chosen.has(s.id)) continue;
      picked.push(s);
      if (picked.length >= limit) break;
    }
  }
  return picked.slice(0, limit).map(s => s.id);
}

async function fetchNoticesByIds(ids: string[]): Promise<Notice[]> {
  if (ids.length === 0) return [];
  const { data } = await supabase
    .from('notices')
    .select(NOTICE_CARD_SELECT)
    .in('id', ids);
  // ids 순서 유지
  const map = new Map((data ?? []).map((n: any) => [n.id, n]));
  return ids.map(id => map.get(id)).filter(Boolean) as Notice[];
}

const NO_READ = new Set<string>();

export function useDigest() {
  const [cacheIds, setCacheIds] = useState<string[]>([]);
  const [allNotices, setAllNotices] = useState<Notice[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  // 캐시된 다이제스트에도 현재 필터(학과·캠퍼스·카테고리·타학과설정)를 실시간 재적용하기 위한 상태.
  const [profile, setProfile] = useState<Profile | null>(null);
  const [disabledTopics, setDisabledTopics] = useState<Set<string>>(new Set());
  const [disabledSources, setDisabledSources] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const mounted = useRef(true);

  const loadFilters = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const [profRes, prefRes, ds] = await Promise.all([
      supabase.from('profiles').select('*').eq('user_id', session.user.id).maybeSingle(),
      supabase.from('user_category_prefs').select('topic,is_enabled').eq('user_id', session.user.id),
      fetchDisabledSources(session.user.id),
    ]);
    if (!mounted.current) return;
    setProfile((profRes.data as Profile) ?? null);
    setDisabledTopics(new Set(((prefRes.data ?? []) as any[]).filter((p) => !p.is_enabled).map((p) => p.topic)));
    setDisabledSources(ds);
  }, []);

  const syncReadIds = useCallback(async () => {
    const [set] = await Promise.all([fetchReadIds(), loadFilters()]);
    if (mounted.current) setReadIds(set);
  }, [loadFilters]);

  // 낙관적 로컬 읽음 처리. 상세 진입 시 서버 read_at 커밋이 홈 포커스 sync보다 늦어
  // 방금 읽은 글(특히 마지막 글)이 안 사라지는 레이스를 방지. 서버 기록은 markAsRead가 별도 수행.
  const markReadLocal = useCallback((id: string) => {
    setReadIds(prev => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);

  const initialize = useCallback(async () => {
    setLoading(true);
    // 네트워크/스토리지 단계가 throw해도 홈이 스켈레톤에 갇히지 않도록 finally에서 해제.
    try {
      const today = new Date().toISOString().slice(0, 10);
      const cached = await loadCache();

      let ids: string[];
      if (cached && cached.date === today) {
        ids = cached.notice_ids;
      } else {
        ids = await computeDigestIds([], 4);
        await saveCache(ids);
      }

      const [notices, readSet] = await Promise.all([
        fetchNoticesByIds(ids),
        fetchReadIds(),
        loadFilters(),
      ]);

      if (mounted.current) {
        setCacheIds(ids);
        setAllNotices(notices);
        setReadIds(readSet);
      }
    } catch (e) {
      console.error('[digest] init failed', e);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [loadFilters]);

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

  // visible = 캐시된 공지 중 아직 안 읽었고, 현재 필터(학과·캠퍼스·카테고리·타학과설정)에 맞는 것.
  //   (다이제스트는 하루 1회 계산·캐시되므로, 설정 변경이 당일에도 반영되도록 표시 단계에서 재필터한다.)
  const visible = useMemo(
    () => allNotices.filter(n =>
      !readIds.has(n.id)
      && (!profile || !isMismatch(n, metaOf(n), profile, disabledTopics, NO_READ, disabledSources)),
    ),
    [allNotices, readIds, profile, disabledTopics, disabledSources],
  );

  // 오늘의 다이제스트를 모두 읽었을 때
  const allSeen = !loading && cacheIds.length > 0 && visible.length === 0;

  return { notices: visible, loading, loadingMore, allSeen, refresh, loadMore, syncReadIds, markReadLocal };
}
