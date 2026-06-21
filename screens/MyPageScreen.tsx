import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Defs, LinearGradient as SvgLinearGradient, Stop } from 'react-native-svg';
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

// 히어로 세로 그라데이션 — 위는 파랑·보라 틴트, 아래로 투명(배경에 녹아듦). 레퍼런스 톤.
const HERO_TINT = ['rgba(110,124,238,0.30)', 'rgba(120,140,238,0.10)', 'transparent'] as const;

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
  // 히어로 실제 크기 측정 → SVG 동심원의 바닥 페이드를 정확히 경계에 맞춘다.
  const [heroSize, setHeroSize] = useState({ w: 0, h: 0 });

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
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* 히어로: 위→아래로 흐려져 배경에 녹아드는 세로 그라데이션 + 은은한 동심원 (레퍼런스) */}
        {profile && (
          <View
            style={[styles.hero, { paddingTop: insets.top + SPACING.xxl }]}
            onLayout={(e) => setHeroSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
          >
            <LinearGradient
              colors={HERO_TINT}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />
            {/* 동심원 장식 — stroke에 세로 그라데이션을 줘 바닥 경계에서 선이 부드럽게 사라지게 */}
            {heroSize.w > 0 && heroSize.h > 0 ? (
              <Svg width={heroSize.w} height={heroSize.h} style={StyleSheet.absoluteFill} pointerEvents="none">
                <Defs>
                  <SvgLinearGradient id="ringFade" x1="0" y1="0" x2="0" y2={heroSize.h} gradientUnits="userSpaceOnUse">
                    <Stop offset="0" stopColor="#6E7CEE" stopOpacity={0.16} />
                    <Stop offset={Math.max(0, (heroSize.h - 56) / heroSize.h)} stopColor="#6E7CEE" stopOpacity={0.16} />
                    <Stop offset="1" stopColor="#6E7CEE" stopOpacity={0} />
                  </SvgLinearGradient>
                </Defs>
                <Circle cx={heroSize.w - 75} cy={45} r={125} stroke="url(#ringFade)" strokeWidth={1.5} fill="none" />
                <Circle cx={heroSize.w - 70} cy={40} r={190} stroke="url(#ringFade)" strokeWidth={1.5} fill="none" />
              </Svg>
            ) : null}

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
                <Text style={styles.heroMeta} numberOfLines={2}>
                  {[CAMPUS_LABEL[profile.campus] ?? profile.campus, deptName || collegeName || null, `${profile.grade}학년`]
                    .filter(Boolean).join(' · ')}
                  {statusText ? `\n${statusText}` : ''}
                  {profile.is_dormitory ? ' · 기숙사' : ''}
                </Text>
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
  scroll: { paddingBottom: SPACING.xxl },
  body: { paddingHorizontal: SPACING.lg },

  // 히어로: 카드가 아니라 배경에 녹아드는 그라데이션 영역(투명 bg + absoluteFill 그라데이션).
  hero: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.xl,
    marginBottom: SPACING.lg,
    overflow: 'hidden', // 동심원/그라데이션이 영역 밖으로 안 새게
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
  heroMeta: { fontSize: FONT.caption, color: COLORS.textSecondary, lineHeight: 18 },

  groupLabel: { ...TEXT.sectionLabel, marginBottom: SPACING.sm },
  groupLabelGap: { marginTop: SPACING.xl }, // 그룹 사이 간격
});
