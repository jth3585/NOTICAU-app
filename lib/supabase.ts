import { createClient } from '@supabase/supabase-js';

// EXPO_PUBLIC_* 변수는 Expo가 빌드 시 인라인. (.env 참고, 커밋 안 함)
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL as string;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string;

// 인증 미사용(public SELECT만) → 세션/스토리지 관련 기능 끔.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});
