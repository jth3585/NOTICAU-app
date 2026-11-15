import { useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useScrollToTop } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../lib/types';
import { COLORS, FONT, SPACING, TEXT, WEIGHT } from '../lib/theme';
import { useProfile, loadProfile } from '../lib/profile';
import { useReadSet } from '../lib/read';
import { useTabReselect } from '../lib/useTabReselect';
import {
  buildEventsLayout, fetchEventsFeed, isEventForMe, isMyUnitEvent, type EventNotice,
} from '../lib/eventsFeed';
import { CategoryChips } from '../components/CategoryChips';
import { EventPosterCard } from '../components/EventPosterCard';
import { EmptyState } from '../components/ui/EmptyState';
import { EventGridSkeleton } from '../components/ui/Skeleton';
import { CalendarIcon } from '../components/ui/icons';

// 행사 탭: 게시판·학생회 인스타에서 뽑은 행사 중 나에게 해당되는 것을 포스터 중심으로 모아 본다.
//  - 맨 위: 오늘·이번 주에 열리는 행사를 큰 포스터 캐러셀로
//  - 그 아래: 2열 포스터 그리드(다가오는 행사 → 참여 이벤트 → 진행 중 → 더 둘러보기)
// 칩은 탭이 아니라 필터다: 전체 / 내 학과(내 학과·단과대가 열거나 내 학과를 대상으로 한 것).
// 참여 이벤트(경품·혜택)는 건수가 적어 칩을 두지 않고 그리드의 한 섹션으로만 보여준다.
const FILTER_ALL = '전체';
const FILTER_MINE = '내 학과';
const FILTERS = [FILTER_ALL, FILTER_MINE] as const;

const STALE_MS = 5 * 60 * 1000; // 탭에 다시 들어왔을 때 이보다 오래됐으면 조용히 새로고침
const GAP = SPACING.md;

// 그리드는 FlatList 한 줄에 카드 두 장씩. 섹션 제목도 같은 목록의 한 줄로 넣는다.
type Row =
  | { key: string; type: 'label'; title: string }
  | { key: string; type: 'pair'; items: EventNotice[] };

export default function EventsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const profile = useProfile();
  const { isRead, refresh: refreshRead } = useReadSet();
  const { width } = useWindowDimensions();

  const [rows, setRows] = useState<EventNotice[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<string>(FILTER_ALL);
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

  const listRef = useRef<FlatList<Row>>(null);
  useScrollToTop(listRef);
  useTabReselect(onRefresh);

  const layout = useMemo(() => {
    if (!profile) return { hero: [], sections: [] };
    let mine = rows.filter((n) => isEventForMe(n, profile));
    if (filter === FILTER_MINE) mine = mine.filter((n) => isMyUnitEvent(n, profile));
    return buildEventsLayout(mine);
  }, [rows, profile, filter]);

  const data = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const s of layout.sections) {
      out.push({ key: `label:${s.title}`, type: 'label', title: s.title });
      for (let i = 0; i < s.data.length; i += 2) {
        const items = s.data.slice(i, i + 2);
        out.push({ key: `pair:${items[0].id}`, type: 'pair', items });
      }
    }
    return out;
  }, [layout.sections]);

  const gridW = Math.floor((width - SPACING.lg * 2 - GAP) / 2);
  const heroW = Math.min(280, Math.round(width * 0.66));

  const open = useCallback(
    (n: EventNotice) => navigation.navigate('Detail', { notice: n, source: 'events' }),
    [navigation],
  );

  const onSelectFilter = useCallback((f: string) => {
    setFilter(f);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, []);

  const top = (
    <View>
      <Text style={styles.pageTitle}>행사</Text>
      <View style={styles.chipsRow}>
        <CategoryChips topics={FILTERS} selected={filter} onSelect={onSelectFilter} />
      </View>
    </View>
  );

  if (loading || !profile) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        {top}
        <EventGridSkeleton />
      </SafeAreaView>
    );
  }

  const header = (
    <View>
      {top}
      {layout.hero.length > 0 ? (
        <View>
          <Text style={styles.sectionLabel}>이번 주</Text>
          <FlatList
            // 필터가 바뀌면 처음 카드로 되돌린다.
            key={filter}
            horizontal
            data={layout.hero}
            keyExtractor={(item) => item.id}
            showsHorizontalScrollIndicator={false}
            snapToInterval={heroW + GAP}
            snapToAlignment="start"
            decelerationRate="fast"
            contentContainerStyle={styles.heroContent}
            ItemSeparatorComponent={HeroGap}
            renderItem={({ item }) => (
              <EventPosterCard
                notice={item}
                variant="hero"
                width={heroW}
                isRead={isRead(item.id)}
                onPress={() => open(item)}
              />
            )}
          />
        </View>
      ) : null}
    </View>
  );

  const empty = layout.hero.length > 0 ? null : failed ? (
    <View style={styles.errorWrap}>
      <Text style={styles.errorText}>행사를 불러오지 못했어요.</Text>
      <TouchableOpacity onPress={onRefresh} hitSlop={10} accessibilityRole="button">
        <Text style={styles.retry}>다시 시도</Text>
      </TouchableOpacity>
    </View>
  ) : (
    <EmptyState
      icon={<CalendarIcon size={30} color={COLORS.textTertiary} />}
      title={filter === FILTER_MINE ? '지금은 내 학과 행사가 없어요' : '지금은 예정된 행사가 없어요'}
      subtitle="새로 올라오면 여기에 모아 둘게요"
    />
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <FlatList
        ref={listRef}
        data={data}
        keyExtractor={(row) => row.key}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.accent} colors={[COLORS.accent]} />
        }
        ListHeaderComponent={header}
        renderItem={({ item: row }) =>
          row.type === 'label' ? (
            <Text style={styles.sectionLabel}>{row.title}</Text>
          ) : (
            <View style={styles.pair}>
              {row.items.map((n) => (
                <EventPosterCard
                  key={n.id}
                  notice={n}
                  width={gridW}
                  isRead={isRead(n.id)}
                  onPress={() => open(n)}
                />
              ))}
            </View>
          )
        }
        ListEmptyComponent={empty ?? undefined}
        contentContainerStyle={styles.listContent}
      />
    </SafeAreaView>
  );
}

function HeroGap() {
  return <View style={{ width: GAP }} />;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  pageTitle: { ...TEXT.pageTitle, paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, paddingBottom: SPACING.sm },
  chipsRow: { paddingBottom: SPACING.sm },
  sectionLabel: {
    fontSize: FONT.caption,
    fontWeight: WEIGHT.bold,
    color: COLORS.textTertiary,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
  },
  // 아래 여백은 카드 그림자가 가로 목록 경계에서 잘리지 않게 하는 자리.
  heroContent: { paddingHorizontal: SPACING.lg, paddingTop: 2, paddingBottom: SPACING.md },
  // alignItems 기본값(stretch)으로 한 줄의 두 카드 높이를 맞춘다.
  pair: { flexDirection: 'row', gap: GAP, paddingHorizontal: SPACING.lg, marginBottom: GAP },
  listContent: { paddingBottom: SPACING.xl, flexGrow: 1 },
  errorWrap: { alignItems: 'center', marginTop: SPACING.xxl, gap: SPACING.md },
  errorText: { fontSize: FONT.body, color: COLORS.textSecondary },
  retry: { fontSize: FONT.body, fontWeight: WEIGHT.semibold, color: COLORS.accentText },
});
