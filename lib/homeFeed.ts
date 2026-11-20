import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import type { Notice, Profile, UserKeyword } from './types';
import { metaOf } from './format';
import { isMismatch, matchKeywordRow } from './matching';
import { NOTICE_CARD_SELECT } from './notices';
import { fetchDisabledSources } from './sourcePrefs';

const NEW_WINDOW_MS = 24 * 60 * 60 * 1000; // "새공지" 윈도우 (최근 24h crawled)
const KEYWORD_WINDOW_MS = 24 * 60 * 60 * 1000; // "키워드매치" 윈도우 (최근 24h 게시 중 매칭)
const DEADLINE_WINDOW_MS = 24 * 60 * 60 * 1000; // "오늘마감" 윈도우 (now ~ now+24h 마감)

export type HomeTab = 'new' | 'keyword' | 'deadline';

export function keywordMatches(notice: Notice, keywords: UserKeyword[]): boolean {
  if (keywords.length === 0) return false;
  const title = notice.title ?? '';
  const body = notice.body_text ?? '';
  return keywords.some((k) => matchKeywordRow(title, body, k));
}

// 공지에 매칭된 첫 키워드 (카드 #태그용)
export function firstMatchedKeyword(notice: Notice, keywords: UserKeyword[]): string | null {
  const title = notice.title ?? '';
  const body = notice.body_text ?? '';
  const hit = keywords.find((k) => matchKeywordRow(title, body, k));
  return hit ? hit.keyword : null;
}

type HomeFeedData = {
  nickname: string | null;
  newList: Notice[];
  keywordList: Notice[];
  deadlineList: Notice[];
  keywords: UserKeyword[];
  newCount: number;
  deadlineSoonCount: number;
};

const EMPTY: HomeFeedData = {
  nickname: null, newList: [], keywordList: [], deadlineList: [], keywords: [], newCount: 0, deadlineSoonCount: 0,
};

// 마지막으로 계산한 홈 데이터. 다음 실행 때 네트워크를 기다리지 않고 먼저 보여 주고 곧바로 새로 받는다.
// 세 목록이 모두 24시간 창이라 너무 오래된 캐시는 버린다. 탈퇴 시 AsyncStorage.clear()로 함께 지워진다.
const HOME_CACHE_KEY = 'noticau:home_feed_cache';
const HOME_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

async function readHomeCache(): Promise<HomeFeedData | null> {
  try {
    const raw = await AsyncStorage.getItem(HOME_CACHE_KEY);
    if (!raw) return null;
    const { savedAt, data } = JSON.parse(raw);
    if (typeof savedAt !== 'number' || Date.now() - savedAt > HOME_CACHE_MAX_AGE_MS) return null;
    return data as HomeFeedData;
  } catch { return null; }
}

function writeHomeCache(data: HomeFeedData): void {
  AsyncStorage.setItem(HOME_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), data })).catch(() => {});
}

export function useHomeFeed() {
  const [data, setData] = useState<HomeFeedData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const loadedOnce = useRef(false);

  const load = useCallback(async () => {
    // 어떤 단계가 throw해도 스켈레톤에 영구히 갇히지 않도록 finally에서 로딩 해제 보장.
    try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setData(EMPTY); return; }
    const uid = session.user.id;
    const now = Date.now();

    // 한 번의 왕복으로 모두 받는다(예전엔 학과 설정·본문 조회가 앞 단계 뒤에 줄줄이 붙어 왕복이 3번).
    // 키워드 매칭은 본문(body_text)까지 훑어야 정확한데, 목록은 경량 select(본문 제외)로 받는다.
    // → 키워드가 있을 때만 '최근 24h' 공지의 본문을 따로 받는다. 키워드 조회(작음)가 끝나는 즉시
    //   시작하므로 무거운 목록 조회와 나란히 진행된다. (전체 300행 본문 ~2.3MB 대신 소량만.)
    const keywordsP = Promise.resolve(
      supabase.from('user_keywords').select('keyword, title_only').eq('user_id', uid),
    );
    const bodiesP = keywordsP.then((r) => ((r.data ?? []).length > 0
      ? supabase.from('notices').select('id, body_text')
        .is('duplicate_of', null)
        .gte('posted_at', new Date(now - KEYWORD_WINDOW_MS).toISOString())
      : null));
    const [profileRes, keywordsRes, prefsRes, noticesRes, disabledSources, bodiesRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('user_id', uid).maybeSingle(),
      keywordsP,
      supabase.from('user_category_prefs').select('topic,is_enabled').eq('user_id', uid),
      supabase.from('notices').select(NOTICE_CARD_SELECT).is('duplicate_of', null).order('posted_at', { ascending: false }).limit(300),
      fetchDisabledSources(uid),
      bodiesP,
    ]);

    const profile = profileRes.data as Profile | null;
    if (!profile) {
      // 조회 실패면 보이던 것(캐시 포함)을 그대로 둔다. 프로필이 정말 없을 때만 비운다.
      if (!profileRes.error) setData(EMPTY);
      return;
    }

    const keywords = (keywordsRes.data ?? []) as UserKeyword[];
    const disabledTopics = new Set<string>(
      ((prefsRes.data ?? []) as any[]).filter((p) => !p.is_enabled).map((p) => p.topic),
    );
    const notices = (noticesRes.data ?? []) as Notice[];
    const bodyRows = (bodiesRes && !bodiesRes.error ? bodiesRes.data ?? [] : []) as any[];
    if (bodyRows.length > 0) {
      const bmap = new Map(bodyRows.map((b) => [b.id, b.body_text]));
      notices.forEach((n) => { if (bmap.has(n.id)) (n as any).body_text = bmap.get(n.id); });
    }

    // 홈 세 탭 공통 베이스: 타깃/카테고리 불일치만 제외. 읽음은 제외하지 않음
    //   (홈은 "지금 챙길 것"을 보여주는 곳 — 읽었어도 24h 새 공지/마감이면 계속 노출).
    const NO_READ = new Set<string>();
    const base = notices.filter((n) => !isMismatch(n, metaOf(n), profile, disabledTopics, NO_READ, disabledSources));

    // 새공지: 최근 24h '게시된' 것 (posted_at 기준 — crawled_at은 우리 DB 적재 시점이라
    //   새 소스 백필 시 과거 공지가 전부 새공지로 뜨는 문제가 생김).
    const newList = base
      .filter((n) => n.posted_at && (now - Date.parse(n.posted_at)) <= NEW_WINDOW_MS)
      .sort((a, b) => (b.posted_at ?? '').localeCompare(a.posted_at ?? ''));

    // 키워드매치: 최근 24h 게시된 것 중 키워드 매칭
    const keywordList = keywords.length
      ? base.filter((n) => n.posted_at
          && (now - Date.parse(n.posted_at)) <= KEYWORD_WINDOW_MS
          && keywordMatches(n, keywords))
        .sort((a, b) => (b.posted_at ?? '').localeCompare(a.posted_at ?? ''))
      : [];

    // 오늘마감: 남은 마감 시간이 0 ~ 24h 이내 (이미 지난 마감 제외).
    const deadlineList = base
      .map((n) => {
        const dl = metaOf(n)?.deadline_at ?? null;
        const ms = dl && !isNaN(Date.parse(dl)) ? Date.parse(dl) - now : null;
        return { n, ms };
      })
      .filter((x) => x.ms !== null && x.ms >= 0 && x.ms <= DEADLINE_WINDOW_MS)
      .sort((a, b) => (a.ms as number) - (b.ms as number))
      .map((x) => x.n);

    const next: HomeFeedData = {
      nickname: profile.nickname ?? null,
      newList, keywordList, deadlineList, keywords,
      newCount: newList.length,
      deadlineSoonCount: deadlineList.length,
    };
    loadedOnce.current = true;
    setData(next);
    writeHomeCache(next);
    } catch (e) {
      // 실패 시 기존 데이터는 유지(빈 화면 깜빡임 방지) — 스피너만 내린다.
      console.error('[homeFeed] load failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // 캐시를 먼저 그리고(있으면 스켈레톤 생략), 새 데이터는 load()가 받아 덮어쓴다.
    readHomeCache().then((cached) => {
      if (cached && !loadedOnce.current) { setData(cached); setLoading(false); }
    });
    load();
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // 호칭만 가볍게 재조회 (프로필 수정 후 홈 포커스 시 즉시 반영, 전체 reload 없이).
  const refreshProfile = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const { data: prof } = await supabase
      .from('profiles').select('nickname').eq('user_id', session.user.id).maybeSingle();
    setData((prev) => ({ ...prev, nickname: (prof as any)?.nickname ?? null }));
  }, []);

  return { ...data, loading, refreshing, refresh, reload: load, refreshProfile };
}
