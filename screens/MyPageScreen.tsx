import { useEffect, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import MaskedView from '@react-native-masked-view/masked-view';
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
// accentGradient(#6E8CEE→#4A90E2→#3A79CE) 색을 알파로 입힌 세로 워시 — 단색보다 깊이감.
const TOP_TINT = ['rgba(110,140,238,0.42)', 'rgba(74,144,226,0.18)', 'transparent'] as const;
// 히어로 블리드 로고의 단색 tint (accentGradient 딥블루 계열, 낮은 알파로 워터마크처럼)
const HERO_LOGO_TINT = 'rgba(58,121,206,0.14)';

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
        {profile && (
          <View style={[styles.hero, { paddingTop: insets.top + SPACING.xxl }]}>
            {/* 브랜드 로고를 좌하단에 크게 블리드 — 단색 tint 워터마크 + 가장자리로 갈수록
                부드럽게 페이드(MaskedView)해서 딱 잘리지 않게 */}
            <MaskedView
              style={styles.heroLogo}
              pointerEvents="none"
              maskElement={
                <LinearGradient
                  colors={['#000', '#000', 'transparent']}
                  locations={[0, 0.4, 1]}
                  start={{ x: 0.85, y: 0.15 }}
                  end={{ x: 0.1, y: 0.95 }}
                  style={StyleSheet.absoluteFill}
                />
              }
            >
              <Image
                source={require('../assets/icon-foreground.png')}
                style={[StyleSheet.absoluteFill, { tintColor: HERO_LOGO_TINT, width: '100%', height: '100%' }]}
                resizeMode="contain"
              />
            </MaskedView>
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
  // 좌하단 블리드 브랜드 로고 (크게 확대 + 가장자리 페이드). 크기·위치는 보면서 조절.
  heroLogo: { position: 'absolute', width: 300, height: 300, bottom: -90, left: -80 },
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
