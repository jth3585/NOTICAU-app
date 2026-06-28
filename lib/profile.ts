import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import type { Profile } from './types';

// 앱 전역 단일 프로필 캐시 + 구독. 프로필 수정이 모든 화면에 즉시 반영되도록
// (DB 라운드트립을 기다리지 않는 낙관적 브로드캐스트) 하기 위한 작은 스토어.
//  - loadProfile(): DB에서 읽어 캐시 갱신 + 브로드캐스트
//  - updateProfile(patch): 캐시 즉시 패치+브로드캐스트 후 DB 기록(실패 시 롤백)
//  - useProfile(): 캐시를 구독하는 훅

let cached: Profile | null = null;
const listeners = new Set<(p: Profile | null) => void>();

function emit() {
  for (const l of listeners) l(cached);
}

export function getCachedProfile(): Profile | null {
  return cached;
}

export async function loadProfile(): Promise<Profile | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { cached = null; emit(); return null; }
  const { data } = await supabase
    .from('profiles').select('*').eq('user_id', session.user.id).maybeSingle();
  cached = (data as Profile) ?? null;
  emit();
  return cached;
}

// 낙관적 갱신: 캐시를 즉시 패치+브로드캐스트한 뒤 DB에 기록. 실패하면 이전 값으로 롤백.
export async function updateProfile(patch: Partial<Profile>): Promise<{ error: string | null }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { error: '로그인이 필요해요' };
  const prev = cached;
  if (cached) { cached = { ...cached, ...patch }; emit(); }
  const { error } = await supabase
    .from('profiles').update(patch as any).eq('user_id', session.user.id);
  if (error) {
    cached = prev; // 롤백
    emit();
    return { error: error.message };
  }
  return { error: null };
}

// 캐시를 구독하는 훅. 첫 구독 시 캐시가 비어 있으면 한 번 로드한다.
export function useProfile(): Profile | null {
  const [p, setP] = useState<Profile | null>(cached);
  useEffect(() => {
    listeners.add(setP);
    if (cached) setP(cached);
    else loadProfile();
    return () => { listeners.delete(setP); };
  }, []);
  return p;
}
