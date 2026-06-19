import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useCallback } from 'react';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabase } from '../lib/supabase';
import type { RootStackParamList } from '../lib/types';
import { COLORS, FONT, RADIUS, SHADOW, SPACING, TEXT, WEIGHT } from '../lib/theme';
import { ChevronRightIcon } from '../components/ui/icons';

type Nav = NativeStackNavigationProp<RootStackParamList>;

type Profile = {
  grade: number;
  campus: string;
  college: string | null;
  dept: string | null;
  enrollment_status: string[];
  is_dormitory: boolean;
};

const CAMPUS_LABEL: Record<string, string> = { seoul: '서울', davinci: '다빈치' };
const STATUS_LABEL: Record<string, string> = {
  enrolled: '재학중', on_leave: '휴학중', graduating: '졸업예정',
};

export default function MyPageScreen() {
  const navigation = useNavigation<Nav>();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [collegeName, setCollegeName] = useState('');
  const [deptName, setDeptName] = useState('');

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const { data } = await supabase.from('profiles').select('*').eq('user_id', session.user.id).maybeSingle();
    if (!data) return;
    setProfile(data as Profile);
    if (data.college) {
      const { data: col } = await supabase.from('colleges').select('name').eq('code', data.college).maybeSingle();
      setCollegeName((col as any)?.name ?? data.college);
    }
    if (data.dept) {
      const { data: dep } = await supabase.from('departments').select('name').eq('code', data.dept).maybeSingle();
      setDeptName((dep as any)?.name ?? data.dept);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const statusText = profile?.enrollment_status?.map(s => STATUS_LABEL[s] ?? s).join(' · ') ?? '';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.pageTitle}>마이페이지</Text>

        {/* 프로필 카드 */}
        {profile && (
          <View style={styles.profileCard}>
            <View style={styles.profileRow}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{profile.grade}학년</Text></View>
              <View style={styles.profileInfo}>
                <Text style={styles.profileMain}>{collegeName || profile.college}</Text>
                {deptName ? <Text style={styles.profileSub}>{deptName}</Text> : null}
                <Text style={styles.profileMeta}>
                  {CAMPUS_LABEL[profile.campus] ?? profile.campus}
                  {statusText ? ` · ${statusText}` : ''}
                  {profile.is_dormitory ? ' · 기숙사' : ''}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* 내 설정 */}
        <Text style={styles.groupLabel}>내 설정</Text>
        <View style={styles.menuGroup}>
          <MenuItem label="프로필 수정" onPress={() => navigation.navigate('ProfileEdit')} />
          <MenuItem label="키워드 관리" onPress={() => navigation.navigate('KeywordManage')} />
          <MenuItem label="카테고리 필터" onPress={() => navigation.navigate('CategoryPrefs')} last />
        </View>

        {/* 앱 정보 */}
        <Text style={styles.groupLabel}>앱 정보</Text>
        <View style={styles.menuGroup}>
          <MenuItem label="알림 설정" onPress={() => navigation.navigate('NotificationSettings')} />
          <MenuItem label="이용약관" onPress={() => navigation.navigate('Terms')} />
          <MenuItem label="개인정보 처리방침" onPress={() => navigation.navigate('Privacy')} last />
        </View>

        {/* 계정 */}
        <Text style={styles.groupLabel}>계정</Text>
        <View style={styles.menuGroup}>
          <MenuItem label="회원 탈퇴" onPress={() => navigation.navigate('DeleteAccount')} danger last />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function MenuItem({ label, onPress, disabled, danger, last }: { label: string; onPress?: () => void; disabled?: boolean; danger?: boolean; last?: boolean }) {
  return (
    <TouchableOpacity style={[styles.menuItem, last && styles.menuItemLast]} onPress={onPress} disabled={disabled} activeOpacity={0.6}>
      <Text style={[styles.menuLabel, disabled && styles.menuDisabled, danger && styles.menuDanger]}>{label}</Text>
      <ChevronRightIcon size={18} color={COLORS.textTertiary} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xxl },
  pageTitle: { ...TEXT.pageTitle, paddingTop: SPACING.sm, marginBottom: SPACING.lg },

  profileCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.card,
    padding: SPACING.lg,
    marginBottom: SPACING.xl,
    ...SHADOW.accent, // 토스 느낌의 컬러 그림자
  },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  avatar: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: COLORS.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: FONT.caption, fontWeight: WEIGHT.bold, color: COLORS.accentText },
  profileInfo: { flex: 1, gap: 2 },
  profileMain: { fontSize: FONT.subtitle, fontWeight: WEIGHT.semibold, color: COLORS.text },
  profileSub: { fontSize: FONT.body, color: COLORS.text },
  profileMeta: { fontSize: FONT.caption, color: COLORS.textSecondary, marginTop: 2 },
  chevron: { fontSize: 20, color: COLORS.textTertiary },

  groupLabel: { ...TEXT.sectionLabel, marginBottom: SPACING.sm },
  menuGroup: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.card,
    marginBottom: SPACING.xl,
    ...SHADOW.card,
  },
  menuItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md + 2,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border,
  },
  menuItemLast: { borderBottomWidth: 0 },
  menuLabel: { fontSize: FONT.body, color: COLORS.text },
  menuDisabled: { color: COLORS.textTertiary },
  menuDanger: { color: COLORS.danger },
});
