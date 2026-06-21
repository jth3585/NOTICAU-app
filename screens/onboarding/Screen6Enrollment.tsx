import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { OnboardingLayout } from '../../components/onboarding/OnboardingLayout';
import { OptionButton } from '../../components/onboarding/OptionButton';
import { CheckCircleIcon } from '../../components/ui/icons';
import { useOnboarding } from '../../contexts/OnboardingContext';
import type { OnboardingStackParamList } from '../../lib/types';
import { COLORS, FONT, SPACING } from '../../lib/theme';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Enrollment'>;

const STATUSES = [
  { value: 'enrolled', label: '재학중' },
  { value: 'on_leave', label: '휴학중' },
  { value: 'graduating', label: '졸업예정' },
];

export default function Screen6Enrollment({ navigation }: Props) {
  const { enrollment_status, is_dormitory, set } = useOnboarding();

  const toggleStatus = (value: string) => {
    const next = enrollment_status.includes(value)
      ? enrollment_status.filter((v) => v !== value)
      : [...enrollment_status, value];
    set({ enrollment_status: next });
  };

  const canComplete = enrollment_status.length > 0 && is_dormitory !== null;

  // 저장(INSERT)은 마지막 호칭 단계(Screen7Nickname)에서 한 번에 수행.
  const handleNext = () => {
    if (canComplete) navigation.navigate('Nickname');
  };

  return (
    <OnboardingLayout
      step={6}
      title="현재 상태를 선택해 주세요"
      subtitle="여러 개 선택할 수 있어요"
      icon={<CheckCircleIcon size={26} color={COLORS.accent} />}
      onBack={() => navigation.goBack()}
      onNext={handleNext}
      nextLabel="다음"
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
    </OnboardingLayout>
  );
}

const styles = StyleSheet.create({
  dormSection: { marginTop: SPACING.lg, gap: SPACING.sm },
  dormLabel: { fontSize: FONT.subtitle, fontWeight: '700', color: COLORS.text, marginBottom: SPACING.xs },
  error: { fontSize: FONT.caption, color: COLORS.danger, marginTop: SPACING.md, textAlign: 'center' },
});
