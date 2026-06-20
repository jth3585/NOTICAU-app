import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useCallback } from 'react';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabase } from '../lib/supabase';
import type { RootStackParamList } from '../lib/types';
import { COLORS, FONT, RADIUS, SHADOW, SPACING, TEXT, WEIGHT } from '../lib/theme';
import {
  ChevronRightIcon, HashIcon, FolderIcon,
  BellIcon, FileTextIcon, ShieldIcon, TrashIcon,
} from '../components/ui/icons';
import { BookmarkIcon } from '../components/ui/BookmarkIcon';
import type { ReactNode } from 'react';

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

const CAMPUS_LABEL: Record<string, string> = { seoul: '서울', davinci: '다빈치' };
const STATUS_LABEL: Record<string, string> = {
  enrolled: '재학중', on_leave: '휴학중', graduating: '졸업예정',
};

export default function MyPageScreen() {
  const navigation = useNavigation<Nav>();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [collegeName, setCollegeName] = useState('');
  const [deptName, setDeptName] = useState('');
  const [bookmarkCount, setBookmarkCount] = useState(0);
  const [keywordCount, setKeywordCount] = useState(0);

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const uid = session.user.id;
    const { data } = await supabase.from('profiles').select('*').eq('user_id', uid).maybeSingle();
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
    // 활동 요약 카운트
    const [bm, kw] = await Promise.all([
      supabase.from('user_feed_state').select('notice_id', { count: 'exact', head: true })
        .eq('user_id', uid).not('bookmarked_at', 'is', null),
      supabase.from('user_keywords').select('keyword', { count: 'exact', head: true }).eq('user_id', uid),
    ]);
    setBookmarkCount(bm.count ?? 0);
    setKeywordCount(kw.count ?? 0);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const statusText = profile?.enrollment_status?.map(s => STATUS_LABEL[s] ?? s).join(' · ') ?? '';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.pageTitle}>마이페이지</Text>

        {/* 히어로 프로필 카드 (그라데이션) */}
        {profile && (
          <LinearGradient
            colors={COLORS.accentGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.hero}
          >
            <TouchableOpacity
              style={styles.editChip}
              onPress={() => navigation.navigate('ProfileEdit')}
              activeOpacity={0.8}
              hitSlop={8}
            >
              <Text style={styles.editChipText}>수정</Text>
            </TouchableOpacity>

            <View style={styles.heroRow}>
              <View style={styles.heroAvatar}>
                <Text style={styles.heroAvatarText}>
                  {(profile.nickname?.trim()?.[0]) ?? `${profile.grade}`}
                </Text>
              </View>
              <View style={styles.heroInfo}>
                <Text style={styles.heroName} numberOfLines={1}>
                  {profile.nickname ? `${profile.nickname}님` : '프로필'}
                </Text>
                <Text style={styles.heroMeta} numberOfLines={2}>
                  {[CAMPUS_LABEL[profile.campus] ?? profile.campus, deptName || collegeName || null, `${profile.grade}학년`]
                    .filter(Boolean).join(' · ')}
                  {statusText ? `\n${statusText}` : ''}
                  {profile.is_dormitory ? ' · 기숙사' : ''}
                </Text>
              </View>
            </View>
          </LinearGradient>
        )}

        {/* 내 활동 요약 */}
        <View style={styles.statsRow}>
          <TouchableOpacity style={styles.statCard} activeOpacity={0.8} onPress={() => navigation.navigate('Bookmark' as never)}>
            <BookmarkIcon size={18} filled color={COLORS.accent} />
            <Text style={styles.statNum}>{bookmarkCount}</Text>
            <Text style={styles.statLabel}>북마크</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.statCard} activeOpacity={0.8} onPress={() => navigation.navigate('KeywordManage')}>
            <HashIcon size={18} color={COLORS.accent} />
            <Text style={styles.statNum}>{keywordCount}</Text>
            <Text style={styles.statLabel}>키워드</Text>
          </TouchableOpacity>
        </View>

        {/* 내 설정 */}
        <Text style={styles.groupLabel}>내 설정</Text>
        <View style={styles.menuGroup}>
          <MenuItem icon={<HashIcon size={16} color={COLORS.textSecondary} />} label="키워드 관리" onPress={() => navigation.navigate('KeywordManage')} />
          <MenuItem icon={<FolderIcon size={16} color={COLORS.textSecondary} />} label="카테고리 필터" onPress={() => navigation.navigate('CategoryPrefs')} last />
        </View>

        {/* 앱 정보 */}
        <Text style={styles.groupLabel}>앱 정보</Text>
        <View style={styles.menuGroup}>
          <MenuItem icon={<BellIcon size={16} color={COLORS.textSecondary} />} label="알림 설정" onPress={() => navigation.navigate('NotificationSettings')} />
          <MenuItem icon={<FileTextIcon size={16} color={COLORS.textSecondary} />} label="이용약관" onPress={() => navigation.navigate('Terms')} />
          <MenuItem icon={<ShieldIcon size={16} color={COLORS.textSecondary} />} label="개인정보 처리방침" onPress={() => navigation.navigate('Privacy')} last />
        </View>

        {/* 계정 */}
        <Text style={styles.groupLabel}>계정</Text>
        <View style={styles.menuGroup}>
          <MenuItem icon={<TrashIcon size={16} color={COLORS.danger} />} label="회원 탈퇴" onPress={() => navigation.navigate('DeleteAccount')} danger last />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function MenuItem({ icon, label, onPress, disabled, danger, last }: { icon?: ReactNode; label: string; onPress?: () => void; disabled?: boolean; danger?: boolean; last?: boolean }) {
  return (
    <TouchableOpacity style={[styles.menuItem, last && styles.menuItemLast]} onPress={onPress} disabled={disabled} activeOpacity={0.6}>
      <View style={styles.menuLeft}>
        {icon ? <View style={[styles.menuIcon, danger && styles.menuIconDanger]}>{icon}</View> : null}
        <Text style={[styles.menuLabel, disabled && styles.menuDisabled, danger && styles.menuDanger]}>{label}</Text>
      </View>
      <ChevronRightIcon size={18} color={COLORS.textTertiary} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xxl },
  pageTitle: { ...TEXT.pageTitle, paddingTop: SPACING.sm, marginBottom: SPACING.lg },

  // 히어로 프로필 카드 (그라데이션 = 학생증/멤버십 느낌)
  hero: {
    borderRadius: RADIUS.card,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
    ...SHADOW.accent,
  },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  heroAvatar: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center', justifyContent: 'center',
  },
  heroAvatarText: { fontSize: FONT.title, fontWeight: WEIGHT.bold, color: '#fff' },
  heroInfo: { flex: 1, gap: 4 },
  heroName: { fontSize: FONT.display, fontWeight: WEIGHT.bold, color: '#fff' },
  heroMeta: { fontSize: FONT.caption, color: 'rgba(255,255,255,0.92)', lineHeight: 18 },
  editChip: {
    position: 'absolute', top: SPACING.md, right: SPACING.md,
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderRadius: RADIUS.pill,
    paddingVertical: 5, paddingHorizontal: SPACING.md,
    zIndex: 1,
  },
  editChipText: { fontSize: FONT.caption, fontWeight: WEIGHT.bold, color: '#fff' },

  // 내 활동 요약
  statsRow: { flexDirection: 'row', gap: SPACING.md, marginBottom: SPACING.xl },
  statCard: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.card,
    paddingVertical: SPACING.lg,
    alignItems: 'center',
    gap: 4,
    ...SHADOW.card,
  },
  statNum: { fontSize: FONT.title, fontWeight: WEIGHT.bold, color: COLORS.text, fontVariant: ['tabular-nums'] },
  statLabel: { fontSize: FONT.caption, color: COLORS.textSecondary },

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
  menuLeft: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, flex: 1 },
  menuIcon: {
    width: 30, height: 30, borderRadius: 9,
    backgroundColor: COLORS.surface2,
    alignItems: 'center', justifyContent: 'center',
  },
  menuIconDanger: { backgroundColor: COLORS.dangerSoft },
  menuLabel: { fontSize: FONT.body, color: COLORS.text },
  menuDisabled: { color: COLORS.textTertiary },
  menuDanger: { color: COLORS.danger },
});
