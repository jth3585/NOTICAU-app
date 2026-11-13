import { useCallback, useMemo, useRef, useState } from 'react';
import { RefreshControl, SectionList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useScrollToTop } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../lib/types';
import { COLORS, FONT, SPACING, TEXT, WEIGHT } from '../lib/theme';
import { useProfile, loadProfile } from '../lib/profile';
import { useReadSet } from '../lib/read';
import { useTabReselect } from '../lib/useTabReselect';
import {
  buildEventSections, buildGiveawaySections, fetchEventsFeed, isEventForMe, type EventNotice,
} from '../lib/eventsFeed';
import { CategoryChips } from '../components/CategoryChips';
import { EventCard } from '../components/EventCard';
import { EmptyState } from '../components/ui/EmptyState';
import { NoticeListSkeleton } from '../components/ui/Skeleton';
import { CalendarIcon } from '../components/ui/icons';

// 행사 탭: 게시판·학생회 인스타에서 뽑은 행사 중 나에게 해당되는 것을 날짜순으로 모아 본다.
//  - 참석 행사: 정해진 일시·장소에 가는 것(특강·설명회·공연·일일호프…)
//  - 참여 이벤트: 경품·혜택처럼 기간 안에 참여하는 것(마감순)
const TAB_ATTEND = '참석 행사';
const TAB_JOIN = '참여 이벤트';
const TABS = [TAB_ATTEND, TAB_JOIN] as const;

const STALE_MS = 5 * 60 * 1000; // 탭에 다시 들어왔을 때 이보다 오래됐으면 조용히 새로고침

export default function EventsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const profile = useProfile();
  const { isRead, refresh: refreshRead } = useReadSet();

  const [rows, setRows] = useState<EventNotice[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<string>(TAB_ATTEND);
  const loadedAtRef = useRef(0);

  const load = useCallback(async () => {
    try {
      setRows(await fetchEventsFeed());
      setFailed(false);
      loadedAtRef.current = Date.now();
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    refreshRead();
    loadProfile(); // 학과·캠퍼스 변경 반영
    if (Date.now() - loadedAtRef.current > STALE_MS) load();
  }, [refreshRead, load]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const listRef = useRef<SectionList<EventNotice>>(null);
  useScrollToTop(listRef);
  useTabReselect(onRefresh);

  const sections = useMemo(() => {
    if (!profile) return [];
    const mine = rows.filter((n) => isEventForMe(n, profile));
    return tab === TAB_ATTEND
      ? buildEventSections(mine.filter((n) => n.event.kind === 'event'))
      : buildGiveawaySections(mine.filter((n) => n.event.kind === 'giveaway'));
  }, [rows, profile, tab]);

  const header = (
    <View>
      <Text style={styles.pageTitle}>행사</Text>
      <View style={styles.tabsRow}>
        <CategoryChips topics={TABS} selected={tab} onSelect={setTab} />
      </View>
    </View>
  );

  if (loading || !profile) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        {header}
        <NoticeListSkeleton />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <SectionList
        ref={listRef}
        sections={sections}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.accent} colors={[COLORS.accent]} />
        }
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={header}
        renderSectionHeader={({ section }) => <Text style={styles.sectionLabel}>{section.title}</Text>}
        renderItem={({ item }) => (
          <EventCard
            notice={item}
            isRead={isRead(item.id)}
            onPress={() => navigation.navigate('Detail', { notice: item, source: 'events' })}
          />
        )}
        ListEmptyComponent={
          failed ? (
            <View style={styles.errorWrap}>
              <Text style={styles.errorText}>행사를 불러오지 못했어요.</Text>
              <TouchableOpacity onPress={onRefresh} hitSlop={10} accessibilityRole="button">
                <Text style={styles.retry}>다시 시도</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <EmptyState
              icon={<CalendarIcon size={30} color={COLORS.textTertiary} />}
              title={tab === TAB_ATTEND ? '지금은 예정된 행사가 없어요' : '지금은 참여할 이벤트가 없어요'}
              subtitle="새로 올라오면 여기에 모아 둘게요"
            />
          )
        }
        contentContainerStyle={styles.listContent}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  pageTitle: { ...TEXT.pageTitle, paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, paddingBottom: SPACING.sm },
  tabsRow: { paddingBottom: SPACING.sm },
  sectionLabel: {
    fontSize: FONT.caption,
    fontWeight: WEIGHT.bold,
    color: COLORS.textTertiary,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
  },
  listContent: { paddingBottom: SPACING.xl, flexGrow: 1 },
  errorWrap: { alignItems: 'center', marginTop: SPACING.xxl, gap: SPACING.md },
  errorText: { fontSize: FONT.body, color: COLORS.textSecondary },
  retry: { fontSize: FONT.body, fontWeight: WEIGHT.semibold, color: COLORS.accentText },
});
