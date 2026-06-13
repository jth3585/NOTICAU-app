import { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { OnboardingLayout } from '../../components/onboarding/OnboardingLayout';
import { useOnboarding } from '../../contexts/OnboardingContext';
import { supabase } from '../../lib/supabase';
import type { OnboardingStackParamList } from '../../lib/types';
import { COLORS, FONT, RADIUS, SPACING, WEIGHT } from '../../lib/theme';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Nickname'>;

const MAX_LEN = 10;

export default function Screen7Nickname({ navigation }: Props) {
  const { grade, campus, college, dept, dept_secondary, enrollment_status, is_dormitory } = useOnboarding();
  const [nickname, setNickname] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 호칭(있으면)을 포함해 프로필 1회 INSERT 후 온보딩 종료.
  const finish = async (nick: string | null) => {
    if (saving) return;
    setSaving(true);
    setError(null);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setError('문제가 생겼어요. 앱을 다시 시작해 주세요.'); setSaving(false); return; }

    const { error: insertErr } = await supabase.from('profiles').insert({
      user_id: session.user.id,
      grade,
      campus,
      college,
      dept,
      dept_secondary,
      enrollment_status,
      is_dormitory: is_dormitory ?? false,
      nickname: nick,
      onboarded_at: new Date().toISOString(),
    });

    if (insertErr) { setError('저장하지 못했어요. 잠시 후 다시 시도해 주세요.'); setSaving(false); return; }

    navigation.getParent()?.reset({ index: 0, routes: [{ name: 'Tabs' }] });
  };

  const trimmed = nickname.trim();

  return (
    <OnboardingLayout
      step={7}
      title="어떻게 불러드릴까요?"
      subtitle="홈 화면 인사에 쓰여요. 입력하지 않아도 괜찮아요."
      onBack={() => navigation.goBack()}
      onNext={() => finish(trimmed)}
      nextLabel={saving ? '저장 중…' : '완료'}
      nextEnabled={trimmed.length > 0 && !saving}
    >
      <TextInput
        style={styles.input}
        placeholder={`호칭 (최대 ${MAX_LEN}자)`}
        placeholderTextColor={COLORS.textTertiary}
        value={nickname}
        onChangeText={(t) => setNickname(t.slice(0, MAX_LEN))}
        returnKeyType="done"
        onSubmitEditing={() => { if (trimmed.length > 0) finish(trimmed); }}
        autoFocus
        editable={!saving}
      />

      <TouchableOpacity style={styles.skip} onPress={() => finish(null)} disabled={saving} hitSlop={8}>
        <Text style={styles.skipText}>건너뛰기</Text>
      </TouchableOpacity>

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </OnboardingLayout>
  );
}

const styles = StyleSheet.create({
  input: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.box,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    fontSize: FONT.body,
    color: COLORS.text,
  },
  skip: { alignItems: 'center', paddingVertical: SPACING.md, marginTop: SPACING.sm },
  skipText: { fontSize: FONT.body, color: COLORS.textSecondary, fontWeight: WEIGHT.semibold },
  error: { fontSize: FONT.caption, color: COLORS.danger, marginTop: SPACING.md, textAlign: 'center' },
});
