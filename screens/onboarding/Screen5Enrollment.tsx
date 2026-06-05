import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { OnboardingLayout } from '../../components/onboarding/OnboardingLayout';
import { OptionButton } from '../../components/onboarding/OptionButton';
import { useOnboarding, type EnrollmentStatus } from '../../contexts/OnboardingContext';
import type { OnboardingStackParamList } from '../../lib/types';
import { StyleSheet, Text, View } from 'react-native';
import { COLORS, FONT, SPACING } from '../../lib/theme';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Enrollment'>;

const STATUSES: { value: EnrollmentStatus; label: string }[] = [
  { value: 'enrolled', label: '재학 중' },
  { value: 'leave', label: '휴학 중' },
  { value: 'returning', label: '복학 예정' },
  { value: 'graduating', label: '졸업 유예' },
];

export default function Screen5Enrollment({ navigation }: Props) {
  const { enrollment_status, is_dormitory, set } = useOnboarding();

  const canNext = enrollment_status !== null && is_dormitory !== null;

  return (
    <OnboardingLayout
      step={5}
      title="현재 어떤 상태인가요?"
      onBack={() => navigation.goBack()}
      onNext={() => navigation.navigate('Career')}
      nextEnabled={canNext}
    >
      {STATUSES.map((s) => (
        <OptionButton
          key={s.value}
          label={s.label}
          selected={enrollment_status === s.value}
          onPress={() => set({ enrollment_status: s.value })}
        />
      ))}

      {enrollment_status !== null && (
        <View style={styles.dormSection}>
          <Text style={styles.dormLabel}>기숙사 거주 중이신가요?</Text>
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
});
