import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import type { Notice, Profile, UserKeyword } from './types';
import { metaOf } from './format';
import { isMismatch } from './matching';

const NEW_WINDOW_MS = 24 * 60 * 60 * 1000; // "새공지" 윈도우 (최근 24h crawled)
const KEYWORD_WINDOW_MS = 24 * 60 * 60 * 1000; // "키워드매치" 윈도우 (최근 24h crawled 중 매칭)
const DEADLINE_WINDOW_MS = 24 * 60 * 60 * 1000; // "오늘마감" 윈도우 (now ~ now+24h 마감)

export type HomeTab = 'new' | 'keyword' | 'deadline';

export function keywordMatches(notice: Notice, keywords: UserKeyword[]): boolean {
  if (keywords.length === 0) return false;
  const hay = `${notice.title} ${notice.body_text ?? ''}`.toLowerCase();
  return keywords.some((k) => hay.includes(k.keyword.toLowerCase()));
}

// 공지에 매칭된 첫 키워드 (카드 #태그용)
export function firstMatchedKeyword(notice: Notice, keywords: UserKeyword[]): string | null {
  const hay = `${notice.title} ${notice.body_text ?? ''}`.toLowerCase();
  const hit = keywords.find((k) => hay.includes(k.keyword.toLowerCase()));
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
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setData(EMPTY); setLoading(false); return; }

    const [profileRes, keywordsRes, prefsRes, readRes, noticesRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('user_id', session.user.id).maybeSingle(),
      supabase.from('user_keywords').select('*').eq('user_id', session.user.id),
      supabase.from('user_category_prefs').select('topic,is_enabled').eq('user_id', session.user.id),
      supabase.from('user_feed_state').select('notice_id').eq('user_id', session.user.id).not('read_at', 'is', null),
      supabase.from('notices').select('*, notice_meta(*), sources(parser_key, name)').order('posted_at', { ascending: false }).limit(300),
    ]);

    const profile = profileRes.data as Profile | null;
    if (!profile) { setData(EMPTY); setLoading(false); return; }

    const keywords = (keywordsRes.data ?? []) as UserKeyword[];
    const disabledTopics = new Set<string>(
      ((prefsRes.data ?? []) as any[]).filter((p) => !p.is_enabled).map((p) => p.topic),
    );
    const readIds = new Set<string>(((readRes.data ?? []) as any[]).map((r: any) => r.notice_id));
    const notices = (noticesRes.data ?? []) as Notice[];

    // 본인과 안 맞는(또는 읽은) 공지 제외한 베이스
    const base = notices.filter((n) => !isMismatch(n, metaOf(n), profile, disabledTopics, readIds));
    const now = Date.now();

    const newList = base
      .filter((n) => n.crawled_at && (now - Date.parse(n.crawled_at)) <= NEW_WINDOW_MS)
      .sort((a, b) => (b.crawled_at ?? '').localeCompare(a.crawled_at ?? ''));

    // 키워드매치: 최근 24h 올라온 것 중 키워드 매칭
    const keywordList = keywords.length
      ? base.filter((n) => n.crawled_at
          && (now - Date.parse(n.crawled_at)) <= KEYWORD_WINDOW_MS
          && keywordMatches(n, keywords))
        .sort((a, b) => (b.crawled_at ?? '').localeCompare(a.crawled_at ?? ''))
      : [];

    // 오늘마감: 남은 마감 시간이 0 ~ 24h 이내 (이미 지난 마감 제외)
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
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return { ...data, loading, refreshing, refresh };
}
