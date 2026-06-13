import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { OnboardingLayout } from '../../components/onboarding/OnboardingLayout';
import { OptionButton } from '../../components/onboarding/OptionButton';
import { useOnboarding } from '../../contexts/OnboardingContext';
import type { OnboardingStackParamList } from '../../lib/types';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Campus'>;

export default function Screen2Campus({ navigation }: Props) {
  const { campus, set } = useOnboarding();

  const handleSelect = (value: 'seoul' | 'davinci') => {
    set({ campus: value, college: null, dept: null, dept_secondary: null });
    navigation.navigate('College');
  };

  return (
    <OnboardingLayout step={2} title="캠퍼스를 선택해 주세요" onBack={() => navigation.goBack()}>
      <OptionButton label="서울" selected={campus === 'seoul'} onPress={() => handleSelect('seoul')} />
      <OptionButton label="다빈치" selected={campus === 'davinci'} onPress={() => handleSelect('davinci')} />
    </OnboardingLayout>
  );
}
