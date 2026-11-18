import { useState, type ReactNode } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { OnboardingLayout } from '../../components/onboarding/OnboardingLayout';
import { BellIcon, CalendarIcon, ClipboardListIcon, HashIcon } from '../../components/ui/icons';
import { useOnboarding, useSaveOnboardingProfile } from '../../contexts/OnboardingContext';
import { requestPushPermission, setupPushNotifications } from '../../lib/push';
import type { OnboardingStackParamList } from '../../lib/types';
import { COLORS, FONT, RADIUS, SPACING, WEIGHT } from '../../lib/theme';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Notify'>;

// 온보딩 마지막 단계: 시스템 권한 창을 띄우기 전에 어떤 알림이 오는지 먼저 보여 준다.
// 알림 권한을 아직 묻지 않은 기기에서만 이 화면으로 온다(Screen7Nickname 이 판단). 프로필 저장도 여기서 한다.
export default function Screen8Notify({ navigation }: Props) {
  const { nickname } = useOnboarding();
  const saveProfile = useSaveOnboardingProfile();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finish = async (askPermission: boolean) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    // 권한 창을 먼저 띄운다(프로필 저장에 실패해도 권한 선택은 이미 끝난 상태로 남는다).
    const perm = askPermission ? await requestPushPermission().catch(() => null) : null;
    const err = await saveProfile(nickname);
    if (err) { setError(err); setSaving(false); return; }
    if (perm?.granted) setupPushNotifications(); // 토큰 발급·저장은 화면 전환을 막지 않게
    navigation.getParent()?.reset({ index: 0, routes: [{ name: 'Tabs' }] });
  };

  return (
    <OnboardingLayout
      step={8}
      title={'새 공지를 놓치지 않게\n알려드릴까요?'}
      subtitle="알림은 언제든 ‘프로필 > 알림 설정’에서 바꿀 수 있어요."
      icon={<BellIcon size={26} color={COLORS.accent} />}
      onBack={saving ? undefined : () => navigation.goBack()}
      onNext={() => finish(true)}
      nextLabel={saving ? '저장 중…' : '알림 받기'}
      nextEnabled={!saving}
    >
      <View style={styles.card}>
        <Row icon={<HashIcon size={18} color={COLORS.accent} />} text="키워드가 담긴 공지가 올라오면 바로" />
        <Row icon={<CalendarIcon size={18} color={COLORS.accent} />} text="내 학과·단과대에 새 행사가 생기면" />
        <Row icon={<ClipboardListIcon size={18} color={COLORS.accent} />} text="매일 저녁 6시, 오늘 올라온 내 공지" />
      </View>

      <TouchableOpacity style={styles.skip} onPress={() => finish(false)} disabled={saving} hitSlop={8}>
        <Text style={styles.skipText}>다음에 할게요</Text>
      </TouchableOpacity>

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </OnboardingLayout>
  );
}

function Row({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowIcon}>{icon}</View>
      <Text style={styles.rowText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.box,
    paddingVertical: SPACING.sm,
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm + 2, gap: SPACING.md },
  rowIcon: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: COLORS.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  rowText: { flex: 1, fontSize: FONT.body, color: COLORS.text, lineHeight: 21 },
  skip: { alignItems: 'center', paddingVertical: SPACING.md, marginTop: SPACING.sm },
  skipText: { fontSize: FONT.body, color: COLORS.textSecondary, fontWeight: WEIGHT.semibold },
  error: { fontSize: FONT.caption, color: COLORS.danger, marginTop: SPACING.md, textAlign: 'center' },
});
