import { createContext, useContext, useState, type ReactNode } from 'react';

export type EnrollmentStatus = 'enrolled' | 'leave' | 'returning' | 'graduating';

export type OnboardingData = {
  grade: number | null;
  campus: 'seoul' | 'anseong' | null;
  college: string | null;
  dept: string | null;
  dept_secondary: string | null;
  enrollment_status: EnrollmentStatus | null;
  is_dormitory: boolean | null;
  career_paths: string[];
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
    enrollment_status: null,
    is_dormitory: null,
    career_paths: [],
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
