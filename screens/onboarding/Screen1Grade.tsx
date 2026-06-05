import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { OnboardingLayout } from '../../components/onboarding/OnboardingLayout';
import { OptionButton } from '../../components/onboarding/OptionButton';
import { useOnboarding } from '../../contexts/OnboardingContext';
import type { OnboardingStackParamList } from '../../lib/types';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Grade'>;

const GRADES = [
  { value: 1, label: '1학년' },
  { value: 2, label: '2학년' },
  { value: 3, label: '3학년' },
  { value: 4, label: '4학년' },
  { value: 5, label: '5학년', sublabel: '초과학기' },
  { value: 6, label: '6학년', sublabel: '초과학기' },
];

export default function Screen1Grade({ navigation }: Props) {
  const { grade, set } = useOnboarding();

  const handleSelect = (value: number) => {
    set({ grade: value });
    navigation.navigate('Campus');
  };

  return (
    <OnboardingLayout step={1} title="몇 학년이세요?">
      {GRADES.map((g) => (
        <OptionButton
          key={g.value}
          label={g.label}
          sublabel={g.sublabel}
          selected={grade === g.value}
          onPress={() => handleSelect(g.value)}
        />
      ))}
    </OnboardingLayout>
  );
}
