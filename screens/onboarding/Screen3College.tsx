import { useEffect, useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { OnboardingLayout } from '../../components/onboarding/OnboardingLayout';
import { OptionButton } from '../../components/onboarding/OptionButton';
import { BookOpenIcon } from '../../components/ui/icons';
import { COLORS } from '../../lib/theme';
import { useOnboarding } from '../../contexts/OnboardingContext';
import { supabase } from '../../lib/supabase';
import type { OnboardingStackParamList } from '../../lib/types';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'College'>;
type Row = { code: string; name: string };

export default function Screen3College({ navigation }: Props) {
  const { campus, college, set } = useOnboarding();
  const [colleges, setColleges] = useState<Row[]>([]);

  useEffect(() => {
    if (!campus) return;
    // campus 'davinci' → DB에 'anseong'으로 저장돼 있을 수 있으나 현재 DB는 davinci 미등록.
    // colleges 테이블의 campus 값으로 필터. 다빈치는 'anseong'으로 저장된 경우도 처리.
    supabase.from('colleges').select('code,name')
      .eq('campus', campus === 'davinci' ? 'anseong' : campus)
      .order('name')
      .then(({ data }) => setColleges((data as Row[]) ?? []));
  }, [campus]);

  const handleSelect = (code: string) => {
    set({ college: code, dept: null });
    navigation.navigate('Dept', { collegeCode: code });
  };

  return (
    <OnboardingLayout step={3} title="단과대학을 선택해 주세요" icon={<BookOpenIcon size={26} color={COLORS.accent} />} onBack={() => navigation.goBack()}>
      {colleges.map((c) => (
        <OptionButton
          key={c.code}
          label={c.name}
          selected={college === c.code}
          onPress={() => handleSelect(c.code)}
        />
      ))}
    </OnboardingLayout>
  );
}
