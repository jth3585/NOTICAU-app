import { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { OnboardingLayout } from '../../components/onboarding/OnboardingLayout';
import { OptionButton } from '../../components/onboarding/OptionButton';
import { useOnboarding } from '../../contexts/OnboardingContext';
import { supabase } from '../../lib/supabase';
import type { OnboardingStackParamList } from '../../lib/types';
import { COLORS, FONT, SPACING } from '../../lib/theme';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Dept'>;
type Row = { code: string; name: string };

export default function Screen4Dept({ navigation, route }: Props) {
  const { collegeCode } = route.params;
  const { dept, set } = useOnboarding();
  const [depts, setDepts] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    supabase.from('departments').select('code,name')
      .eq('college_code', collegeCode).order('name')
      .then(({ data }) => { setDepts((data as Row[]) ?? []); setLoaded(true); });
  }, [collegeCode]);

  const handleSelect = (code: string) => {
    set({ dept: code });
    navigation.navigate('SecondaryDept');
  };

  const handleSkip = () => {
    set({ dept: null });
    navigation.navigate('SecondaryDept');
  };

  return (
    <OnboardingLayout step={4} title="학과를 선택해 주세요" onBack={() => navigation.goBack()}>
      {loaded && depts.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>현재 학과 정보 준비 중입니다.</Text>
          <TouchableOpacity style={styles.skipBtn} onPress={handleSkip}>
            <Text style={styles.skipText}>건너뛰기</Text>
          </TouchableOpacity>
        </View>
      ) : (
        depts.map((d) => (
          <OptionButton
            key={d.code}
            label={d.name}
            selected={dept === d.code}
            onPress={() => handleSelect(d.code)}
          />
        ))
      )}
    </OnboardingLayout>
  );
}

const styles = StyleSheet.create({
  empty: { gap: SPACING.md, paddingTop: SPACING.sm },
  emptyText: { fontSize: FONT.body, color: COLORS.textSecondary, lineHeight: 22 },
  skipBtn: { alignSelf: 'flex-start' },
  skipText: { fontSize: FONT.body, color: COLORS.accentText, fontWeight: '600' },
});
