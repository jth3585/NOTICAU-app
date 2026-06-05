import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { OnboardingLayout } from '../../components/onboarding/OnboardingLayout';
import { useOnboarding } from '../../contexts/OnboardingContext';
import { supabase } from '../../lib/supabase';
import type { OnboardingStackParamList } from '../../lib/types';
import { COLORS, FONT, RADIUS, SPACING, WEIGHT } from '../../lib/theme';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Career'>;

const CAREER_OPTIONS = [
  { value: 'employment', label: '취업' },
  { value: 'grad_school', label: '대학원' },
  { value: 'startup', label: '창업' },
  { value: 'civil_service', label: '공무원' },
  { value: 'study_abroad', label: '유학' },
  { value: 'undecided', label: '미정' },
];

export default function Screen6Career({ navigation }: Props) {
  const { career_paths, set, ...profile } = useOnboarding();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (value: string) => {
    const next = career_paths.includes(value)
      ? career_paths.filter((v) => v !== value)
      : [...career_paths, value];
    set({ career_paths: next });
  };

  const handleComplete = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setError('세션 오류. 앱을 재시작해 주세요.'); setSaving(false); return; }

    const { error: insertErr } = await supabase.from('profiles').insert({
      user_id: session.user.id,
      grade: profile.grade,
      campus: profile.campus,
      college: profile.college,
      dept: profile.dept ?? profile.college, // 학과 데이터 없는 단대는 college code로 대체
      dept_secondary: profile.dept_secondary,
      enrollment_status: profile.enrollment_status,
      is_dormitory: profile.is_dormitory ?? false,
      career_paths,
      onboarded_at: new Date().toISOString(),
    });

    if (insertErr) {
      setError('저장 실패: ' + insertErr.message);
      setSaving(false);
      return;
    }

    // 온보딩 완료 → Main으로 reset
    navigation.getParent()?.reset({ index: 0, routes: [{ name: 'Tabs' }] });
  };

  return (
    <OnboardingLayout
      step={6}
      title="관심 진로를 선택해 주세요"
      subtitle="복수 선택 가능합니다"
      onBack={() => navigation.goBack()}
      onNext={handleComplete}
      nextLabel={saving ? '저장 중…' : '완료'}
      nextEnabled={career_paths.length > 0 && !saving}
    >
      <View style={styles.grid}>
        {CAREER_OPTIONS.map((opt) => {
          const selected = career_paths.includes(opt.value);
          return (
            <TouchableOpacity
              key={opt.value}
              style={[styles.chip, selected && styles.chipSelected]}
              onPress={() => toggle(opt.value)}
              activeOpacity={0.7}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </OnboardingLayout>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    marginTop: SPACING.sm,
  },
  chip: {
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: RADIUS.pill,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    backgroundColor: COLORS.bg,
  },
  chipSelected: { borderColor: COLORS.accent, backgroundColor: COLORS.accentSoft },
  chipText: { fontSize: FONT.body, color: COLORS.text, fontWeight: WEIGHT.semibold },
  chipTextSelected: { color: COLORS.accentText },
  error: { fontSize: FONT.caption, color: COLORS.danger, marginTop: SPACING.md, textAlign: 'center' },
});
