import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Image as SvgImage, Defs, LinearGradient as SvgLinearGradient, Stop, Mask, Rect, G } from 'react-native-svg';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useCallback } from 'react';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabase } from '../lib/supabase';
import { useProfile, loadProfile } from '../lib/profile';
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
  dept_secondary: string | null;
  enrollment_status: string[];
  is_dormitory: boolean;
  show_cross_dept?: boolean;
};

// 상단 컬러 워시 — 홈과 동일하게 ScrollView '뒤'에 절대배치해, 위로 당겨도(오버스크롤)
// 흰 바탕 대신 이 색이 이어져 보이게 한다.
// accentGradient(#6E8CEE→#4A90E2→#3A79CE) 색을 알파로 입힌 세로 워시 — 단색보다 깊이감.
const TOP_TINT = ['rgba(110,140,238,0.42)', 'rgba(74,144,226,0.18)', 'transparent'] as const;
// 히어로 블리드 로고는 원본 풀컬러를 낮은 불투명도로 — 두 마름모의 색·톤 차이를 살림.
const HERO_LOGO_OPACITY = 0.22;
const HERO_LOGO_SIZE = 300;

const CAMPUS_LABEL: Record<string, string> = { seoul: '서울', davinci: '다빈치' };
const STATUS_LABEL: Record<string, string> = {
  enrolled: '재학중', on_leave: '휴학중', graduating: '졸업예정',
};

export default function MyPageScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  // 공유 스토어 구독 → 프로필 수정이 즉시(낙관적) 반영. 포커스 시 DB에서 최신화.
  const profile = useProfile() as Profile | null;
  const [collegeName, setCollegeName] = useState('');
  const [deptName, setDeptName] = useState('');
  const [secondaryName, setSecondaryName] = useState('');

  useFocusEffect(useCallback(() => { loadProfile(); }, []));

  // 단과대/학과 코드 → 표시 이름. college/dept가 null이 되면(캠퍼스 변경 등) 이름도 비운다.
  useEffect(() => {
    if (!profile?.college) { setCollegeName(''); return; }
    let alive = true;
    supabase.from('colleges').select('name').eq('code', profile.college).maybeSingle()
      .then(({ data }) => { if (alive) setCollegeName((data as any)?.name ?? profile.college ?? ''); });
    return () => { alive = false; };
  }, [profile?.college]);

  useEffect(() => {
    if (!profile?.dept) { setDeptName(''); return; }
    let alive = true;
    supabase.from('departments').select('name').eq('code', profile.dept).maybeSingle()
      .then(({ data }) => { if (alive) setDeptName((data as any)?.name ?? profile.dept ?? ''); });
    return () => { alive = false; };
  }, [profile?.dept]);

  // 복수전공 코드 → 이름. 학과 코드 우선, 없으면 단과대 코드로 폴백(학과 미세분 시 단대만 저장됨).
  useEffect(() => {
    const code = profile?.dept_secondary;
    if (!code) { setSecondaryName(''); return; }
    let alive = true;
    (async () => {
      const { data: d } = await supabase.from('departments').select('name').eq('code', code).maybeSingle();
      if ((d as any)?.name) { if (alive) setSecondaryName((d as any).name); return; }
      const { data: c } = await supabase.from('colleges').select('name').eq('code', code).maybeSingle();
      if (alive) setSecondaryName((c as any)?.name ?? code);
    })();
    return () => { alive = false; };
  }, [profile?.dept_secondary]);

  const statusText = profile?.enrollment_status?.map(s => STATUS_LABEL[s] ?? s).join(' · ') ?? '';

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
        {/* 히어로 컨테이너는 항상 렌더 → 프로필 로딩 중에도 상단 안전영역 여백이 유지돼
            상단 잘림/스크롤 막힘을 방지. SVG 로고 위치는 기존 그대로(상단 블리드). */}
        <View style={[styles.hero, { paddingTop: insets.top + SPACING.xxl }]}>
            {/* 브랜드 로고를 우측에 크게 블리드 — 원본 풀컬러(낮은 불투명도)로 두 마름모의
                색·톤 차이를 살리고, 아래로 갈수록 부드럽게 페이드(SVG 마스크) */}
            <Svg width={HERO_LOGO_SIZE} height={HERO_LOGO_SIZE} style={styles.heroLogo} pointerEvents="none">
              <Defs>
                <SvgLinearGradient id="heroFade" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor="#fff" stopOpacity="1" />
                  <Stop offset="0.5" stopColor="#fff" stopOpacity="1" />
                  <Stop offset="0.82" stopColor="#fff" stopOpacity="0" />
                </SvgLinearGradient>
                <Mask id="heroMask" x="0" y="0" width={HERO_LOGO_SIZE} height={HERO_LOGO_SIZE} maskUnits="userSpaceOnUse">
                  <Rect x="0" y="0" width={HERO_LOGO_SIZE} height={HERO_LOGO_SIZE} fill="url(#heroFade)" />
                </Mask>
              </Defs>
              <G mask="url(#heroMask)">
                <SvgImage
                  href={require('../assets/icon-foreground.png')}
                  width={HERO_LOGO_SIZE}
                  height={HERO_LOGO_SIZE}
                  preserveAspectRatio="xMidYMid meet"
                  opacity={HERO_LOGO_OPACITY}
                />
              </G>
            </Svg>
            {profile && (
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
                  {[
                    CAMPUS_LABEL[profile.campus] ?? profile.campus,
                    deptName || collegeName || null,
                    secondaryName || null,
                    `${profile.grade}학년`,
                  ].filter(Boolean).join(' · ')}
                  {statusText ? `\n${statusText}` : ''}
                  {profile.is_dormitory ? ' · 기숙사' : ''}
                </Text>
              </View>
            </View>
            )}
          </View>

        <View style={styles.body}>
        {/* 내 설정 */}
        <Text style={styles.groupLabel}>내 설정</Text>
        <SettingsGroup>
          <SettingsRow icon={<HashIcon size={16} color={COLORS.textSecondary} />} label="키워드 관리" onPress={() => navigation.navigate('KeywordManage')} />
          <SettingsRow icon={<FolderIcon size={16} color={COLORS.textSecondary} />} label="전체공지 관리" onPress={() => navigation.navigate('CategoryPrefs')} last />
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

  // 히어로: 투명 영역(뒤 워시가 비침) + 은은한 동심원 장식.
  hero: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.xl,
    marginBottom: SPACING.lg,
    overflow: 'hidden', // 동심원이 영역 밖으로 안 새게
  },
  // 우측 블리드 브랜드 로고 (크게 확대 + 하단 페이드). 크기는 HERO_LOGO_SIZE, 위치는 여기서 조절.
  heroLogo: { position: 'absolute', top: -30, right: -80 },
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
