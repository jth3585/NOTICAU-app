import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

export async function ensureAnonSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) return session;
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) {
    console.error('[auth] anon signin failed', error.message);
    return null;
  }
  return data.session;
}

// 탈퇴: 사용자의 모든 DB 데이터 삭제 + 로그아웃 + 로컬 스토리지 초기화.
// RLS로 본인 데이터만 삭제 가능. 익명 user_id는 auth 시스템 특성상 즉시 삭제 안 될 수 있음(처리방침 3조 명시).
export async function deleteAccount(): Promise<boolean> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return false;
  const uid = session.user.id;

  // DB 삭제는 세션이 살아있는 동안 수행.
  const results = await Promise.all([
    supabase.from('user_feed_state').delete().eq('user_id', uid),
    supabase.from('user_keywords').delete().eq('user_id', uid),
    supabase.from('user_category_prefs').delete().eq('user_id', uid),
    supabase.from('user_source_prefs').delete().eq('user_id', uid),
    supabase.from('bookmark_folders').delete().eq('user_id', uid),
    supabase.from('user_events').delete().eq('user_id', uid), // 행동로그 (delete 정책: security_hardening)
    supabase.from('push_tokens').delete().eq('user_id', uid),
    supabase.from('events').delete().eq('user_id', uid),
    supabase.from('profiles').delete().eq('user_id', uid),
  ]);
  const failed = results.find(r => r.error);
  if (failed?.error) {
    console.error('[auth] deleteAccount DB 삭제 실패', failed.error.message);
    return false;
  }

  // 로그아웃 → 로컬 스토리지 초기화 (순서 중요: clear가 세션도 지우므로 signOut 먼저).
  await supabase.auth.signOut();
  await AsyncStorage.clear();
  return true;
}
