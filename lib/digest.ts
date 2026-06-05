import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import type { Notice, Profile, UserKeyword } from './types';
import { metaOf, sourceOf } from './format';
import { isMismatch, calculateMatchScore } from './matching';

async function fetchDigest(): Promise<Notice[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return [];

  const [profileRes, keywordsRes, prefsRes, readRes, noticesRes] = await Promise.all([
    supabase.from('profiles').select('*').eq('user_id', session.user.id).maybeSingle(),
    supabase.from('user_keywords').select('*').eq('user_id', session.user.id),
    supabase.from('user_category_prefs').select('topic,is_enabled').eq('user_id', session.user.id),
    supabase.from('user_feed_state').select('notice_id').eq('user_id', session.user.id).not('read_at', 'is', null),
    supabase.from('notices').select('*, notice_meta(*), sources(parser_key, name)').order('posted_at', { ascending: false }).limit(200),
  ]);

  const profile = profileRes.data as Profile | null;
  if (!profile) return [];

  const keywords = (keywordsRes.data ?? []) as UserKeyword[];
  const disabledTopics = new Set<string>(
    ((prefsRes.data ?? []) as any[]).filter(p => !p.is_enabled).map(p => p.topic),
  );
  const readIds = new Set<string>(((readRes.data ?? []) as any[]).map(r => r.notice_id));
  const notices = (noticesRes.data ?? []) as Notice[];

  const scored = notices
    .filter(n => !isMismatch(n, metaOf(n), profile, disabledTopics, readIds))
    .map(n => ({
      notice: n,
      score: calculateMatchScore(n, metaOf(n), profile, keywords, sourceOf(n)),
    }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 5).map(s => s.notice);
}

export function useDigest() {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const result = await fetchDigest();
    if (mountedRef.current) { setNotices(result); setLoading(false); }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    return () => { mountedRef.current = false; };
  }, [refresh]);

  return { notices, loading, refresh };
}
