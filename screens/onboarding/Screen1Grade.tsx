import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { OnboardingLayout } from '../../components/onboarding/OnboardingLayout';
import { OptionButton } from '../../components/onboarding/OptionButton';
import { GraduationCapIcon } from '../../components/ui/icons';
import { COLORS } from '../../lib/theme';
import { useOnboarding } from '../../contexts/OnboardingContext';
import type { OnboardingStackParamList } from '../../lib/types';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Grade'>;

const GRADES = [1, 2, 3, 4, 5, 6];

export default function Screen1Grade({ navigation }: Props) {
  const { grade, set } = useOnboarding();

  const handleSelect = (value: number) => {
    set({ grade: value });
    navigation.navigate('Campus');
  };

  return (
    <OnboardingLayout step={1} title="학년을 선택해 주세요" icon={<GraduationCapIcon size={26} color={COLORS.accent} />}>
      {GRADES.map((g) => (
        <OptionButton
          key={g}
          label={`${g}학년`}
          selected={grade === g}
          onPress={() => handleSelect(g)}
        />
      ))}
    </OnboardingLayout>
  );
}
