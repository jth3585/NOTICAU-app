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

export default function Screen5SecondaryDept({ navigation }: Props) {
  const { dept_secondary, set } = useOnboarding();
  const [showPicker, setShowPicker] = useState(false);
  const [allDepts, setAllDepts] = useState<Row[]>([]);

  useEffect(() => {
    if (!showPicker) return;
    supabase.from('departments').select('code,name').order('name')
      .then(({ data }) => setAllDepts((data as Row[]) ?? []));
  }, [showPicker]);

  const goNext = () => navigation.navigate('Enrollment');

  const handleNone = () => { set({ dept_secondary: null }); goNext(); };
  const handleSelect = (code: string) => { set({ dept_secondary: code }); goNext(); };

  return (
    <OnboardingLayout step={5} title="복수전공이 있나요?" onBack={() => navigation.goBack()}>
      {!showPicker ? (
        <>
          <OptionButton label="없음" selected={false} onPress={handleNone} />
          <OptionButton label="있음" selected={false} onPress={() => setShowPicker(true)} />
        </>
      ) : (
        <View style={styles.picker}>
          <Text style={styles.label}>복수전공 학과를 선택해 주세요</Text>
          {allDepts.map((d) => (
            <OptionButton
              key={d.code}
              label={d.name}
              selected={dept_secondary === d.code}
              onPress={() => handleSelect(d.code)}
            />
          ))}
          <OptionButton label="건너뛰기" selected={false} onPress={handleNone} />
        </View>
      )}
    </OnboardingLayout>
  );
}

const styles = StyleSheet.create({
  picker: { gap: SPACING.sm },
  label: { fontSize: FONT.caption, color: COLORS.textSecondary, fontWeight: '600', marginBottom: SPACING.xs },
});
