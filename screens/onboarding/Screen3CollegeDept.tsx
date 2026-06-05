import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { OnboardingLayout } from '../../components/onboarding/OnboardingLayout';
import { OptionButton } from '../../components/onboarding/OptionButton';
import { useOnboarding } from '../../contexts/OnboardingContext';
import { supabase } from '../../lib/supabase';
import type { OnboardingStackParamList } from '../../lib/types';
import { COLORS, FONT, SPACING } from '../../lib/theme';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'CollegeDept'>;

type Row = { code: string; name: string };

export default function Screen3CollegeDept({ navigation }: Props) {
  const { campus, college, dept, set } = useOnboarding();
  const [colleges, setColleges] = useState<Row[]>([]);
  const [depts, setDepts] = useState<Row[]>([]);

  useEffect(() => {
    if (!campus) return;
    supabase.from('colleges').select('code,name').eq('campus', campus)
      .order('name').then(({ data }) => setColleges((data as Row[]) ?? []));
  }, [campus]);

  useEffect(() => {
    if (!college) { setDepts([]); return; }
    supabase.from('departments').select('code,name').eq('college_code', college)
      .order('name').then(({ data }) => setDepts((data as Row[]) ?? []));
  }, [college]);

  const handleCollege = (code: string) => {
    set({ college: code, dept: null });
  };

  const canNext = !!college && (depts.length === 0 || !!dept);

  return (
    <OnboardingLayout
      step={3}
      title="단과대학과 학과를 선택해 주세요"
      onBack={() => navigation.goBack()}
      onNext={() => navigation.navigate('SecondaryDept')}
      nextEnabled={canNext}
    >
      {/* 단대 선택 */}
      {colleges.map((c) => (
        <OptionButton
          key={c.code}
          label={c.name}
          selected={college === c.code}
          onPress={() => handleCollege(c.code)}
        />
      ))}

      {/* 학과 선택 */}
      {college && (
        <View style={styles.deptSection}>
          <Text style={styles.deptLabel}>학과</Text>
          {depts.length > 0
            ? depts.map((d) => (
                <OptionButton
                  key={d.code}
                  label={d.name}
                  selected={dept === d.code}
                  onPress={() => set({ dept: d.code })}
                />
              ))
            : <Text style={styles.noDept}>현재 학과 정보 준비 중입니다.{'\n'}단과대학만 선택 후 다음으로 넘어가세요.</Text>
          }
        </View>
      )}
    </OnboardingLayout>
  );
}

const styles = StyleSheet.create({
  deptSection: { marginTop: SPACING.lg, gap: SPACING.sm },
  deptLabel: { fontSize: FONT.caption, color: COLORS.textSecondary, fontWeight: '600', marginBottom: SPACING.xs },
  noDept: { fontSize: FONT.body, color: COLORS.textSecondary, lineHeight: 22, paddingVertical: SPACING.sm },
});
