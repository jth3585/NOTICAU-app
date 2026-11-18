import { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { OnboardingLayout } from '../../components/onboarding/OnboardingLayout';
import { UserIcon } from '../../components/ui/icons';
import * as Device from 'expo-device';
import { useOnboarding, useSaveOnboardingProfile } from '../../contexts/OnboardingContext';
import { getPushPermission, setupPushNotifications } from '../../lib/push';
import type { OnboardingStackParamList } from '../../lib/types';
import { COLORS, FONT, RADIUS, SPACING, WEIGHT } from '../../lib/theme';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Nickname'>;

const MAX_LEN = 10;

export default function Screen7Nickname({ navigation }: Props) {
  const { set } = useOnboarding();
  const saveProfile = useSaveOnboardingProfile();
  const [nickname, setNickname] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 알림 권한을 아직 묻지 않은 기기면 알림 단계로 넘어가 이유를 먼저 보여 준다(프로필 저장은 그 단계에서).
  // 이미 정해진 기기(시뮬레이터 포함)는 여기서 프로필을 저장하고 온보딩을 끝낸다.
  const finish = async (nick: string | null) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    set({ nickname: nick });

    const perm = Device.isDevice ? await getPushPermission().catch(() => null) : null;
    if (perm?.undetermined) {
      setSaving(false);
      navigation.navigate('Notify');
      return;
    }

    const err = await saveProfile(nick);
    if (err) { setError(err); setSaving(false); return; }
    if (perm?.granted) setupPushNotifications();
    navigation.getParent()?.reset({ index: 0, routes: [{ name: 'Tabs' }] });
  };

  const trimmed = nickname.trim();

  return (
    <OnboardingLayout
      step={7}
      title="어떻게 불러드릴까요?"
      subtitle="홈 화면 인사에 쓰여요. 입력하지 않아도 괜찮아요."
      icon={<UserIcon size={26} color={COLORS.accent} />}
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
