import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useCallback } from 'react';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabase } from '../lib/supabase';
import type { RootStackParamList } from '../lib/types';
import { COLORS, FONT, RADIUS, SHADOW, SPACING, TEXT, WEIGHT } from '../lib/theme';
import { HashIcon, FolderIcon, BellIcon, UserIcon, PencilIcon } from '../components/ui/icons';
import { SettingsGroup, SettingsRow } from '../components/ui/SettingsRow';

type Nav = NativeStackNavigationProp<RootStackParamList>;

type Profile = {
  nickname: string | null;
  grade: number;
  campus: string;
  college: string | null;
  dept: string | null;
  enrollment_status: string[];
  is_dormitory: boolean;
};

// 상단 컬러 워시 — 홈과 동일하게 ScrollView '뒤'에 절대배치해, 위로 당겨도(오버스크롤)
// 흰 바탕 대신 이 색이 이어져 보이게 한다.
const TOP_TINT = ['rgba(110,124,238,0.42)', 'rgba(110,124,238,0.16)', 'transparent'] as const;

const CAMPUS_LABEL: Record<string, string> = { seoul: '서울', davinci: '다빈치' };
const STATUS_LABEL: Record<string, string> = {
  enrolled: '재학중', on_leave: '휴학중', graduating: '졸업예정',
};

export default function MyPageScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
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

  // 프로필 메타를 칩(배지) 목록으로 — 캠퍼스 · 학과/단과대 · 학년 · 재학상태 · 기숙사
  const chips = profile
    ? ([
        CAMPUS_LABEL[profile.campus] ?? profile.campus,
        deptName || collegeName || null,
        `${profile.grade}학년`,
        ...(profile.enrollment_status ?? []).map(s => STATUS_LABEL[s] ?? s),
        profile.is_dormitory ? '기숙사' : null,
      ].filter(Boolean) as string[])
    : [];

  return (
    <View style={styles.container}>
      {/* 상단 컬러 워시 — ScrollView 뒤 절대배치. 오버스크롤 시 이 색이 드러남(홈과 동일 방식) */}
      <LinearGradient
        colors={TOP_TINT}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={styles.topTint}
        pointerEvents="none"
      />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {profile && (
          <View style={[styles.hero, { paddingTop: insets.top + SPACING.xxl }]}>
            <View style={styles.heroRow}>
              <LinearGradient colors={COLORS.accentGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.heroAvatar}>
                <Text style={styles.heroAvatarText}>
                  {(profile.nickname?.trim()?.[0]) ?? `${profile.grade}`}
                </Text>
              </LinearGradient>
              <View style={styles.heroInfo}>
                <View style={styles.nameRow}>
                  <Text style={styles.heroName} numberOfLines={1}>
                    {profile.nickname ?? '프로필'}
                  </Text>
                  <TouchableOpacity
                    onPress={() => navigation.navigate('ProfileEdit')}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel="프로필 수정"
                  >
                    <PencilIcon size={16} color={COLORS.textSecondary} />
                  </TouchableOpacity>
                </View>
                <View style={styles.chipRow}>
                  {chips.map((c) => (
                    <View key={c} style={styles.metaChip}>
                      <Text style={styles.metaChipText}>{c}</Text>
                    </View>
                  ))}
                </View>
              </View>
            </View>
          </View>
        )}

        <View style={styles.body}>
        {/* 내 설정 */}
        <Text style={styles.groupLabel}>내 설정</Text>
        <SettingsGroup>
          <SettingsRow icon={<HashIcon size={16} color={COLORS.textSecondary} />} label="키워드 관리" onPress={() => navigation.navigate('KeywordManage')} />
          <SettingsRow icon={<FolderIcon size={16} color={COLORS.textSecondary} />} label="카테고리 필터" onPress={() => navigation.navigate('CategoryPrefs')} last />
        </SettingsGroup>

        {/* 앱 정보 */}
        <Text style={[styles.groupLabel, styles.groupLabelGap]}>앱 정보</Text>
        <SettingsGroup>
          <SettingsRow icon={<BellIcon size={16} color={COLORS.textSecondary} />} label="알림 설정" onPress={() => navigation.navigate('NotificationSettings')} />
          <SettingsRow icon={<UserIcon size={16} color={COLORS.textSecondary} />} label="계정 정보" onPress={() => navigation.navigate('AccountInfo')} last />
        </SettingsGroup>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  // 상단 워시: ScrollView 뒤에 깔리는 절대배치 그라데이션 (홈과 동일 방식)
  topTint: { position: 'absolute', top: 0, left: 0, right: 0, height: 300 },
  scroll: { paddingBottom: SPACING.xxl },
  body: { paddingHorizontal: SPACING.lg },

  // 히어로: 투명 영역(뒤 워시가 비침). 아바타·이름만 배치.
  hero: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.xl,
    marginBottom: SPACING.lg,
  },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  heroAvatar: {
    width: 56, height: 56, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  heroAvatarText: { fontSize: FONT.title, fontWeight: WEIGHT.bold, color: '#fff' },
  heroInfo: { flex: 1, gap: 4 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  heroName: { flexShrink: 1, fontSize: FONT.display, fontWeight: WEIGHT.bold, color: COLORS.text },
  // 프로필 정보 칩(배지)
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, marginTop: SPACING.xs },
  metaChip: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SPACING.sm + 2,
    paddingVertical: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
  },
  metaChipText: { fontSize: FONT.micro, color: COLORS.textSecondary, fontWeight: WEIGHT.semibold },

  groupLabel: { ...TEXT.sectionLabel, marginBottom: SPACING.sm },
  groupLabelGap: { marginTop: SPACING.xl }, // 그룹 사이 간격
});
