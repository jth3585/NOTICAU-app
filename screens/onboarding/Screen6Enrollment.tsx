import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { OnboardingLayout } from '../../components/onboarding/OnboardingLayout';
import { OptionButton } from '../../components/onboarding/OptionButton';
import { useOnboarding } from '../../contexts/OnboardingContext';
import { supabase } from '../../lib/supabase';
import type { OnboardingStackParamList } from '../../lib/types';
import { COLORS, FONT, SPACING } from '../../lib/theme';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Enrollment'>;

const STATUSES = [
  { value: 'enrolled', label: '재학중' },
  { value: 'on_leave', label: '휴학중' },
  { value: 'graduating', label: '졸업예정' },
];

export default function Screen6Enrollment({ navigation }: Props) {
  const { enrollment_status, is_dormitory, set, ...profile } = useOnboarding();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleStatus = (value: string) => {
    const next = enrollment_status.includes(value)
      ? enrollment_status.filter((v) => v !== value)
      : [...enrollment_status, value];
    set({ enrollment_status: next });
  };

  const canComplete = enrollment_status.length > 0 && is_dormitory !== null && !saving;

  const handleComplete = async () => {
    if (!canComplete) return;
    setSaving(true);
    setError(null);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setError('세션 오류. 앱을 재시작해 주세요.'); setSaving(false); return; }

    const { error: insertErr } = await supabase.from('profiles').insert({
      user_id: session.user.id,
      grade: profile.grade,
      campus: profile.campus,
      college: profile.college,
      dept: profile.dept,
      dept_secondary: profile.dept_secondary,
      enrollment_status,
      is_dormitory: is_dormitory ?? false,
      onboarded_at: new Date().toISOString(),
    });

    if (insertErr) {
      setError('저장 실패: ' + insertErr.message);
      setSaving(false);
      return;
    }

    navigation.getParent()?.reset({ index: 0, routes: [{ name: 'Tabs' }] });
  };

  return (
    <OnboardingLayout
      step={6}
      title="현재 상태를 선택해 주세요"
      subtitle="복수 선택 가능합니다"
      onBack={() => navigation.goBack()}
      onNext={handleComplete}
      nextLabel={saving ? '저장 중…' : '완료'}
      nextEnabled={canComplete}
    >
      {STATUSES.map((s) => (
        <OptionButton
          key={s.value}
          label={s.label}
          selected={enrollment_status.includes(s.value)}
          onPress={() => toggleStatus(s.value)}
        />
      ))}

      {enrollment_status.length > 0 && (
        <View style={styles.dormSection}>
          <Text style={styles.dormLabel}>기숙사에 거주하고 있나요?</Text>
          <OptionButton label="예" selected={is_dormitory === true} onPress={() => set({ is_dormitory: true })} />
          <OptionButton label="아니요" selected={is_dormitory === false} onPress={() => set({ is_dormitory: false })} />
        </View>
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </OnboardingLayout>
  );
}

const styles = StyleSheet.create({
  dormSection: { marginTop: SPACING.lg, gap: SPACING.sm },
  dormLabel: { fontSize: FONT.subtitle, fontWeight: '700', color: COLORS.text, marginBottom: SPACING.xs },
  error: { fontSize: FONT.caption, color: COLORS.danger, marginTop: SPACING.md, textAlign: 'center' },
});
