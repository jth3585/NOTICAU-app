import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';

export type OnboardingData = {
  grade: number | null;
  campus: 'seoul' | 'davinci' | null;
  college: string | null;
  dept: string | null;
  dept_secondary: string | null;
  enrollment_status: string[];
  is_dormitory: boolean | null;
  nickname: string | null; // 호칭 단계에서 정한 값(알림 단계에서 프로필을 저장할 때 쓴다)
};

type OnboardingContextType = OnboardingData & {
  set: (patch: Partial<OnboardingData>) => void;
};

const OnboardingContext = createContext<OnboardingContextType | null>(null);

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<OnboardingData>({
    grade: null,
    campus: null,
    college: null,
    dept: null,
    dept_secondary: null,
    enrollment_status: [],
    is_dormitory: null,
    nickname: null,
  });

  const set = (patch: Partial<OnboardingData>) =>
    setData((prev) => ({ ...prev, ...patch }));

  return (
    <OnboardingContext.Provider value={{ ...data, set }}>
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error('useOnboarding must be inside OnboardingProvider');
  return ctx;
}

// 온보딩 결과로 프로필을 1회 INSERT. 실패하면 사용자에게 보여 줄 문구를, 성공하면 null 을 돌려준다.
// 호칭 단계(알림 권한을 이미 정한 기기)와 알림 단계 두 곳에서 마지막에 부른다.
export function useSaveOnboardingProfile() {
  const { grade, campus, college, dept, dept_secondary, enrollment_status, is_dormitory } = useOnboarding();
  return useCallback(async (nickname: string | null): Promise<string | null> => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return '문제가 생겼어요. 앱을 다시 시작해 주세요.';
    const { error } = await supabase.from('profiles').insert({
      user_id: session.user.id,
      grade,
      campus,
      college,
      dept,
      dept_secondary,
      enrollment_status,
      is_dormitory: is_dormitory ?? false,
      nickname,
      onboarded_at: new Date().toISOString(),
      event_alerts_enabled: true, // 내 학과 행사 알림: 새 가입자는 처음부터 켠다
    });
    return error ? '저장하지 못했어요. 잠시 후 다시 시도해 주세요.' : null;
  }, [grade, campus, college, dept, dept_secondary, enrollment_status, is_dormitory]);
}
