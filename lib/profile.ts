import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import type { Profile } from './types';

// "이 기기에서 온보딩을 마쳤다"는 로컬 표시. 앱을 켤 때 이 값이 있으면 프로필 조회(네트워크)를
// 기다리지 않고 바로 탭 화면을 띄운다. 탈퇴 시 AsyncStorage.clear()로 함께 지워진다.
const PROFILE_FLAG = 'noticau:has_profile';

export async function hasKnownProfile(): Promise<boolean> {
  try { return (await AsyncStorage.getItem(PROFILE_FLAG)) === '1'; } catch { return false; }
}

export function setKnownProfile(has: boolean): void {
  (has ? AsyncStorage.setItem(PROFILE_FLAG, '1') : AsyncStorage.removeItem(PROFILE_FLAG)).catch(() => {});
}

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

// 낙관적 갱신: 캐시를 즉시 패치+브로드캐스트한 뒤 DB에 기록.
// 매 호출마다 세션을 직접 얻으므로(마운트 시점 ref에 의존하지 않음) 화면 진입 직후 빠른
// 변경에도 쓰기가 누락되지 않는다. 실패 시 서버에서 재동기화(다른 in-flight 변경을 덮지 않게
// 스냅샷 롤백 대신 loadProfile로 정합성 회복).
export async function updateProfile(patch: Partial<Profile>): Promise<{ error: string | null }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { error: '로그인이 필요해요' };
  if (cached) { cached = { ...cached, ...patch }; emit(); }
  const { error } = await supabase
    .from('profiles').update(patch as any).eq('user_id', session.user.id);
  if (error) {
    await loadProfile().catch(() => {}); // 서버 최신값으로 재동기화
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
