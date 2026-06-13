import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { OnboardingLayout } from '../../components/onboarding/OnboardingLayout';
import { OptionButton } from '../../components/onboarding/OptionButton';
import { useOnboarding } from '../../contexts/OnboardingContext';
import { supabase } from '../../lib/supabase';
import type { OnboardingStackParamList } from '../../lib/types';
import { COLORS, FONT, SPACING } from '../../lib/theme';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'SecondaryDept'>;
type Row = { code: string; name: string };

type Step = 'choice' | 'college' | 'dept';

export default function Screen5SecondaryDept({ navigation }: Props) {
  const { campus, dept_secondary, set } = useOnboarding();
  const [step, setStep] = useState<Step>('choice');
  const [colleges, setColleges] = useState<Row[]>([]);
  const [depts, setDepts] = useState<Row[]>([]);
  const [selectedCollege, setSelectedCollege] = useState<string | null>(null);

  // 모든 단대 로드 (캠퍼스 무관)
  useEffect(() => {
    supabase.from('colleges').select('code,name').order('name')
      .then(({ data }) => setColleges((data as Row[]) ?? []));
  }, []);

  // 선택된 단대의 학과 로드
  useEffect(() => {
    if (!selectedCollege) { setDepts([]); return; }
    supabase.from('departments').select('code,name')
      .eq('college_code', selectedCollege).order('name')
      .then(({ data }) => setDepts((data as Row[]) ?? []));
  }, [selectedCollege]);

  const goNext = () => navigation.navigate('Enrollment');

  const handleNone = () => { set({ dept_secondary: null }); goNext(); };

  const handleCollegeSelect = (code: string) => {
    setSelectedCollege(code);
    setStep('dept');
  };

  const handleDeptSelect = (code: string) => {
    set({ dept_secondary: code });
    goNext();
  };

  const titleMap: Record<Step, string> = {
    choice: '복수전공이 있나요?',
    college: '복수전공 단과대학을 선택해 주세요',
    dept: '복수전공 학과를 선택해 주세요',
  };

  const handleBack = () => {
    if (step === 'dept') { setStep('college'); return; }
    if (step === 'college') { setStep('choice'); return; }
    navigation.goBack();
  };

  const collegeName = colleges.find(c => c.code === selectedCollege)?.name ?? '';

  return (
    <OnboardingLayout step={5} title={titleMap[step]} onBack={handleBack}>
      {step === 'choice' && (
        <>
          <OptionButton label="없음" selected={false} onPress={handleNone} />
          <OptionButton label="있음" selected={false} onPress={() => setStep('college')} />
        </>
      )}

      {step === 'college' && colleges.map((c) => (
        <OptionButton
          key={c.code}
          label={c.name}
          selected={selectedCollege === c.code}
          onPress={() => handleCollegeSelect(c.code)}
        />
      ))}

      {step === 'dept' && (
        <>
          {depts.length > 0
            ? depts.map((d) => (
                <OptionButton
                  key={d.code}
                  label={d.name}
                  selected={dept_secondary === d.code}
                  onPress={() => handleDeptSelect(d.code)}
                />
              ))
            : (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>현재 학과 정보를 준비 중이에요.</Text>
              </View>
            )
          }
          <OptionButton label="건너뛰기" selected={false} onPress={handleNone} />
        </>
      )}
    </OnboardingLayout>
  );
}

const styles = StyleSheet.create({
  empty: { paddingVertical: SPACING.sm },
  emptyText: { fontSize: FONT.body, color: COLORS.textSecondary, lineHeight: 22 },
});
