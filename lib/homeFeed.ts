import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import type { Notice, Profile, UserKeyword } from './types';
import { metaOf } from './format';
import { isMismatch, matchKeyword } from './matching';
import { NOTICE_CARD_SELECT } from './notices';

const NEW_WINDOW_MS = 24 * 60 * 60 * 1000; // "새공지" 윈도우 (최근 24h crawled)
const KEYWORD_WINDOW_MS = 24 * 60 * 60 * 1000; // "키워드매치" 윈도우 (최근 24h 게시 중 매칭)
const DEADLINE_WINDOW_MS = 24 * 60 * 60 * 1000; // "오늘마감" 윈도우 (now ~ now+24h 마감)

export type HomeTab = 'new' | 'keyword' | 'deadline';

export function keywordMatches(notice: Notice, keywords: UserKeyword[]): boolean {
  if (keywords.length === 0) return false;
  const hay = `${notice.title} ${notice.body_text ?? ''}`.toLowerCase();
  return keywords.some((k) => matchKeyword(hay, k.keyword));
}

// 공지에 매칭된 첫 키워드 (카드 #태그용)
export function firstMatchedKeyword(notice: Notice, keywords: UserKeyword[]): string | null {
  const hay = `${notice.title} ${notice.body_text ?? ''}`.toLowerCase();
  const hit = keywords.find((k) => matchKeyword(hay, k.keyword));
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

export function useHomeFeed() {
  const [data, setData] = useState<HomeFeedData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    // 어떤 단계가 throw해도 스켈레톤에 영구히 갇히지 않도록 finally에서 로딩 해제 보장.
    try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setData(EMPTY); return; }

    const [profileRes, keywordsRes, prefsRes, noticesRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('user_id', session.user.id).maybeSingle(),
      supabase.from('user_keywords').select('*').eq('user_id', session.user.id),
      supabase.from('user_category_prefs').select('topic,is_enabled').eq('user_id', session.user.id),
      supabase.from('notices').select(NOTICE_CARD_SELECT).is('duplicate_of', null).order('posted_at', { ascending: false }).limit(300),
    ]);

    const profile = profileRes.data as Profile | null;
    if (!profile) { setData(EMPTY); return; }

    const keywords = (keywordsRes.data ?? []) as UserKeyword[];
    const disabledTopics = new Set<string>(
      ((prefsRes.data ?? []) as any[]).filter((p) => !p.is_enabled).map((p) => p.topic),
    );
    const notices = (noticesRes.data ?? []) as Notice[];
    const now = Date.now();

    // 키워드 매칭은 본문(body_text)까지 훑어야 정확한데, 목록은 경량 select(본문 제외)로 받는다.
    // → 키워드가 있을 때만, 매칭 대상인 '최근 24h' 공지에 한해 body_text를 별도 로드해 채운다.
    //   (전체 300행 본문을 받던 ~2.3MB 비용 대신 소량만.)
    if (keywords.length > 0) {
      const recentIds = notices
        .filter((n) => n.posted_at && (now - Date.parse(n.posted_at)) <= KEYWORD_WINDOW_MS)
        .map((n) => n.id);
      if (recentIds.length > 0) {
        const { data: bodies } = await supabase.from('notices').select('id, body_text').in('id', recentIds);
        const bmap = new Map(((bodies ?? []) as any[]).map((b) => [b.id, b.body_text]));
        notices.forEach((n) => { if (bmap.has(n.id)) (n as any).body_text = bmap.get(n.id); });
      }
    }

    // 홈 세 탭 공통 베이스: 타깃/카테고리 불일치만 제외. 읽음은 제외하지 않음
    //   (홈은 "지금 챙길 것"을 보여주는 곳 — 읽었어도 24h 새 공지/마감이면 계속 노출).
    const NO_READ = new Set<string>();
    const base = notices.filter((n) => !isMismatch(n, metaOf(n), profile, disabledTopics, NO_READ));

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

    setData({
      nickname: profile.nickname ?? null,
      newList, keywordList, deadlineList, keywords,
      newCount: newList.length,
      deadlineSoonCount: deadlineList.length,
    });
    } catch (e) {
      // 실패 시 기존 데이터는 유지(빈 화면 깜빡임 방지) — 스피너만 내린다.
      console.error('[homeFeed] load failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

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
