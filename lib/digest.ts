import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabase';
import type { Notice, NoticeMeta, Profile, UserKeyword } from './types';
import { kstDayKey, metaOf, sourceOf } from './format';
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
  const date = kstDayKey(new Date());
  await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ date, notice_ids: ids }));
}

async function appendCache(newIds: string[]): Promise<void> {
  const cached = await loadCache();
  const existing = cached?.notice_ids ?? [];
  const merged = [...existing, ...newIds.filter(id => !existing.includes(id))];
  const date = kstDayKey(new Date());
  await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ date, notice_ids: merged }));
}

// 매칭 점수 기반 notice ID 목록 계산 (excludeIds 제외).
// 계산할 수 없으면(세션·프로필 없음, 조회 실패) null — 호출부가 빈 결과를 '오늘 추천'으로 저장하지 않게.
async function computeDigestIds(excludeIds: string[], limit: number): Promise<string[] | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;

  const [profileRes, keywordsRes, prefsRes, readRes, noticesRes, disabledSources] = await Promise.all([
    supabase.from('profiles').select('*').eq('user_id', session.user.id).maybeSingle(),
    supabase.from('user_keywords').select('keyword, title_only').eq('user_id', session.user.id),
    supabase.from('user_category_prefs').select('topic,is_enabled').eq('user_id', session.user.id),
    supabase.from('user_feed_state').select('notice_id').eq('user_id', session.user.id).not('read_at', 'is', null),
    // 교차출처 중복은 대표 1건만(홈·공지 탭과 같게) — 같은 공지가 추천에 두 번 뜨지 않게.
    supabase.from('notices').select(NOTICE_CARD_SELECT).is('duplicate_of', null).order('posted_at', { ascending: false }).limit(300),
    fetchDisabledSources(session.user.id),
  ]);

  if (profileRes.error || readRes.error || noticesRes.error) return null;
  const profile = profileRes.data as Profile | null;
  if (!profile) return null;

  const keywords = (keywordsRes.data ?? []) as UserKeyword[];
  const disabledTopics = new Set<string>(
    ((prefsRes.data ?? []) as any[]).filter(p => !p.is_enabled).map(p => p.topic),
  );
  const readIds = new Set<string>(((readRes.data ?? []) as any[]).map((r: any) => r.notice_id));
  const notices = (noticesRes.data ?? []) as Notice[];
  const excludeSet = new Set(excludeIds);

  // 점수를 매길 후보(내 조건에 맞고, 안 읽었고, 마감 안 지난 것)만 남긴다. 본문이 필요 없는 단계.
  const candidates = notices
    .filter(n => !excludeSet.has(n.id))
    .filter(n => !isMismatch(n, metaOf(n), profile, disabledTopics, readIds, disabledSources))
    .filter(n => !isExpiredActionable(metaOf(n)));

  // 스코어링의 키워드 항목만 body_text가 필요 → 키워드가 있을 때만, 후보에 한해 본문을 받는다.
  // (예전엔 300행 전부의 본문을 받았는데, 걸러질 공지 본문은 점수에 쓰이지 않는다.)
  if (keywords.length > 0 && candidates.length > 0) {
    const { data: bodies } = await supabase.from('notices').select('id, body_text').in('id', candidates.map((n) => n.id));
    const bmap = new Map(((bodies ?? []) as any[]).map((b) => [b.id, b.body_text]));
    candidates.forEach((n) => { if (bmap.has(n.id)) (n as any).body_text = bmap.get(n.id); });
  }

  const scored = candidates
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
    // 조회 실패 시엔 기존 필터를 유지한다(프로필이 null 이 되면 필터 없이 다 보여 버린다).
    if (!profRes.error) setProfile((profRes.data as Profile) ?? null);
    if (!prefRes.error) setDisabledTopics(new Set(((prefRes.data ?? []) as any[]).filter((p) => !p.is_enabled).map((p) => p.topic)));
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
      const today = kstDayKey(new Date());
      const cached = await loadCache();

      let ids: string[];
      if (cached && cached.date === today) {
        ids = cached.notice_ids;
      } else {
        // 계산에 실패하면 저장하지 않는다 → 다음 진입·당겨서 새로고침 때 다시 계산.
        const computed = await computeDigestIds([], 4);
        ids = computed ?? [];
        if (computed) await saveCache(computed);
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

  // pull-to-refresh: 읽음 상태만 재동기. 추천이 비어 있으면(계산 실패 등) 새로 계산한다.
  const refresh = useCallback(async () => {
    if (cacheIds.length === 0) await initialize();
    else await syncReadIds();
  }, [cacheIds.length, initialize, syncReadIds]);

  // 추천 더보기: 기존 캐시 제외 + 5개 추가
  const loadMore = useCallback(async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    const newIds = (await computeDigestIds(cacheIds, 5)) ?? [];
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
