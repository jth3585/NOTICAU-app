import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator, AppState, Keyboard, RefreshControl, SectionList, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { Easing, FadeIn, FadeOut, FadeInDown, FadeOutUp } from 'react-native-reanimated';
import { useFocusEffect, useNavigation, useScrollToTop } from '@react-navigation/native';
import { useTabReselect } from '../lib/useTabReselect';
import { useCallback } from 'react';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabase } from '../lib/supabase';
import type { Notice, RootStackParamList } from '../lib/types';
import { CHIP_TOPICS } from '../lib/constants';
import { orderedCategories } from '../lib/categories';
import { COLORS, FONT, RADIUS, SPACING, TEXT, WEIGHT } from '../lib/theme';
import { isPostedToday, metaOf, sourceOf, sortNotices, type SortMode } from '../lib/format';
import { isMismatch } from '../lib/matching';
import { useProfile, loadProfile } from '../lib/profile';
import { CategoryChips } from '../components/CategoryChips';
import { NoticeCard } from '../components/NoticeCard';
import { SwipeToBookmark } from '../components/SwipeToBookmark';
import { SearchIcon } from '../components/ui/SearchIcon';
import { SortIcon } from '../components/ui/SortIcon';
import { CloseIcon, ClipboardListIcon, ChevronUpIcon } from '../components/ui/icons';
import { EmptyState } from '../components/ui/EmptyState';
import { NoticeListSkeleton } from '../components/ui/Skeleton';
import { PressableScale } from '../components/ui/PressableScale';
import { useReadSet } from '../lib/read';
import { NOTICE_CARD_SELECT } from '../lib/notices';
import { useBookmarkSet, addBookmark } from '../lib/bookmarks';
import { lightHaptic, softHaptic } from '../lib/haptics';
import { toast } from '../lib/toast';
import { getRecentSearches, addRecentSearch, clearRecentSearches } from '../lib/recentSearches';
import { useLastSeenAt, touchLastSeenAt } from '../lib/new-badge';

const SORT_LABELS: Record<SortMode, string> = {
  deadline: '마감일순',
  posted: '등록일순',
};

// 인박스는 읽은 공지도 계속 노출 → isMismatch의 readIds 자리에 넘길 빈 셋(안정 참조).
const NO_READ: Set<string> = new Set();

export default function InboxScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>('전체');
  const [sortMode, setSortMode] = useState<SortMode>('deadline');

  // 정렬 칩 탭 → 바로 토글 + 토스트로 결과 안내 (팝오버 없이 1탭).
  const cycleSort = () => {
    const next: SortMode = sortMode === 'deadline' ? 'posted' : 'deadline';
    setSortMode(next);
    softHaptic();
    toast(`${SORT_LABELS[next]}으로 바꿨어요`, 'sort');
  };

  // 검색
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Notice[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  // 제안 패널은 '제출(엔터/칩선택)' 전까지 유지 → 타이핑 중 깜빡 사라지지 않게.
  const [submitted, setSubmitted] = useState(false);
  const [recents, setRecents] = useState<string[]>([]);
  const [myKeywords, setMyKeywords] = useState<string[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const rememberSearch = useCallback((q: string) => {
    if (q.trim()) addRecentSearch(q).then(setRecents);
  }, []);

  // 읽음 / NEW
  const { isRead, refresh: refreshRead } = useReadSet();
  const { isBookmarked, markBookmarked, refresh: refreshBookmarks } = useBookmarkSet();
  const { lastSeenAt } = useLastSeenAt();

  // 스와이프 → 북마크 추가 (토글 아님). 이미 북마크면 피드백만.
  const onSwipeBookmark = useCallback((id: string) => {
    lightHaptic();
    markBookmarked(id); // optimistic
    addBookmark(id);
    toast('북마크에 추가했어요', 'success');
  }, [markBookmarked]);

  const onSwipeAlready = useCallback(() => {
    softHaptic();
    toast('이미 북마크된 공지예요');
  }, []);

  // 카테고리 OFF 프리프 (topic → false인 것들) + 사용자 정렬 칩 순서
  const [disabledTopics, setDisabledTopics] = useState<Set<string>>(new Set());
  const [chipTopics, setChipTopics] = useState<string[]>([...CHIP_TOPICS]);
  // 내 프로필(공유 스토어). 학과/캠퍼스 등 타게팅 필터(isMismatch)에 사용.
  const profile = useProfile();

  // 출처(게시판) 캠퍼스 귀속 필터. 'both'(본교)·null·캠퍼스 미확인은 통과. (검색 결과용)
  const campusAllows = useCallback((n: Notice) => {
    const campus = profile?.campus ?? null;
    const sc = sourceOf(n)?.campus;
    if (!sc || sc === 'both' || !campus) return true;
    if (sc === campus) return true;
    if (sc === 'anseong' && campus === 'davinci') return true;
    return false;
  }, [profile?.campus]);

  useFocusEffect(useCallback(() => {
    refreshRead();
    refreshBookmarks();
    loadProfile(); // 프로필 최신화(학과/캠퍼스 변경 반영)
    getRecentSearches().then(setRecents);
    // 카테고리 프리프 + 내 키워드 새로고침
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const [prefRes, kwRes] = await Promise.all([
        supabase.from('user_category_prefs').select('topic,is_enabled,sort_order').eq('user_id', session.user.id),
        supabase.from('user_keywords').select('keyword').eq('user_id', session.user.id),
      ]);
      const rows = (prefRes.data ?? []) as any[];
      const disabled = new Set<string>();
      rows.forEach((r) => { if (!r.is_enabled) disabled.add(r.topic); });
      setDisabledTopics(disabled);
      setChipTopics(['전체', ...orderedCategories(rows)]);
      setMyKeywords(((kwRes.data ?? []) as any[]).map((k) => k.keyword));
    })();
  }, [refreshRead, refreshBookmarks]));

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') touchLastSeenAt();
    });
    return () => sub.remove();
  }, []);

  const [refreshing, setRefreshing] = useState(false);
  // 무한 스크롤: posted_at desc 단일 풀을 페이지 단위로 누적. 카테고리/캠퍼스/끈토픽/정렬은
  // 모두 이 풀 위에서 클라이언트 필터링되므로, 전체든 특정 카테고리든 바닥에 닿으면 동일하게
  // 다음 페이지를 받아 풀을 키운다.
  const PAGE_INITIAL = 500; // 첫 로드(요청: 500건 노출 후부터 추가 로드)
  const PAGE_MORE = 300;    // 이후 추가 로드 페이지 크기
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false); // 중복 onEndReached 방지(in-flight 가드)

  const fetchPage = useCallback(async (offset: number, size: number) => {
    return supabase
      .from('notices')
      .select(NOTICE_CARD_SELECT)
      .is('duplicate_of', null) // 교차출처 중복은 대표 1건만
      .order('posted_at', { ascending: false })
      .range(offset, offset + size - 1);
  }, []);

  // 첫 로드/새로고침: 풀을 첫 페이지로 리셋.
  const loadNotices = useCallback(async () => {
    const { data, error } = await fetchPage(0, PAGE_INITIAL);
    if (error) { setError(error.message); return; }
    const rows = (data ?? []) as Notice[];
    setNotices(rows);
    setHasMore(rows.length === PAGE_INITIAL);
  }, [fetchPage]);

  // 바닥 도달: 현재 풀 길이를 오프셋으로 다음 페이지를 받아 누적(id 중복 제거).
  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const offset = notices.length;
    const { data, error } = await fetchPage(offset, PAGE_MORE);
    if (!error) {
      const rows = (data ?? []) as Notice[];
      setNotices((prev) => {
        const seen = new Set(prev.map((n) => n.id));
        return [...prev, ...rows.filter((n) => !seen.has(n.id))];
      });
      setHasMore(rows.length === PAGE_MORE);
    }
    loadingMoreRef.current = false;
    setLoadingMore(false);
  }, [fetchPage, hasMore, notices.length]);

  useEffect(() => {
    (async () => { await loadNotices(); setLoading(false); })();
  }, [loadNotices]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadNotices();
    setRefreshing(false);
  }, [loadNotices]);

  // 전체 공지 탭 재탭 → 맨 위로 스크롤 + 새로고침
  const listRef = useRef<SectionList<Notice>>(null);
  useScrollToTop(listRef);
  useTabReselect(onRefresh);

  // 아래로 스크롤하면 뜨는 '맨 위로' 플로팅 버튼
  const [showTop, setShowTop] = useState(false);
  const onListScroll = useCallback((e: { nativeEvent: { contentOffset: { y: number } } }) => {
    const y = e.nativeEvent.contentOffset.y;
    setShowTop((prev) => (prev === y > 600 ? prev : y > 600));
  }, []);
  const scrollTop = useCallback(() => {
    listRef.current?.getScrollResponder()?.scrollTo({ y: 0, animated: true });
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) { setSearchResults([]); setSearching(false); return; }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const { data: ids, error: rpcErr } = await supabase
          .rpc('search_notices', { q: query.trim() });
        if (!rpcErr && ids && ids.length > 0) {
          const { data } = await supabase
            .from('notices')
            .select(NOTICE_CARD_SELECT)
            .in('id', (ids as { id: string }[]).map((r) => r.id))
            .is('duplicate_of', null)
            .order('posted_at', { ascending: false });
          setSearchResults((data ?? []) as Notice[]);
        } else if (!rpcErr) {
          setSearchResults([]);
        } else {
          const { data } = await supabase
            .from('notices')
            .select(NOTICE_CARD_SELECT)
            .ilike('title', `%${query.trim()}%`)
            .is('duplicate_of', null)
            .order('posted_at', { ascending: false })
            .limit(50);
          setSearchResults((data ?? []) as Notice[]);
        }
      } catch {
        setSearchResults([]);
      }
      setSearching(false);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  const isNew = useCallback((n: Notice) => {
    if (isRead(n.id)) return false;
    if (!lastSeenAt) return false;
    return (n.posted_at ?? '') > lastSeenAt;
  }, [isRead, lastSeenAt]);

  // 인박스 피드도 홈과 동일한 타게팅 필터(isMismatch) 적용 → 타 학과 한정 공지(학사·재학상태 등
  // target_depts 있는 공지)가 전체/카테고리 피드에 새지 않게 한다. 인박스는 읽은 공지도 계속
  // 보여주므로 readIds는 빈 셋(NO_READ)으로 둔다(= 홈 패턴).
  const visible = useMemo(() => {
    // 검색 결과도 전체공지 피드와 동일한 타게팅 필터(isMismatch) 적용 → 타 학과/캠퍼스·끈 카테고리
    // 공지는 검색에서도 제외. 프로필 로딩 전엔 캠퍼스만으로 폴백.
    if (query.trim()) {
      if (!profile) return searchResults.filter(campusAllows);
      return searchResults.filter((n) => !isMismatch(n, metaOf(n), profile, disabledTopics, NO_READ));
    }
    if (!profile) return [];
    const matched = notices.filter((n) => !isMismatch(n, metaOf(n), profile, disabledTopics, NO_READ));
    const f = selected === '전체' ? matched : matched.filter((n) => metaOf(n)?.topic === selected);
    return sortNotices(f, sortMode);
  }, [notices, selected, sortMode, query, searchResults, disabledTopics, profile, campusAllows]);

  if (loading) return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={{ height: SPACING.sm }} />
      <NoticeListSkeleton />
    </SafeAreaView>
  );
  if (error) return <Centered>공지를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</Centered>;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <SectionList
        ref={listRef}
        sections={[{ data: visible }]}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.accent} />
        }
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onScroll={onListScroll}
        scrollEventThrottle={16}
        onEndReachedThreshold={0.6}
        onEndReached={() => { if (!query.trim()) loadMore(); }}
        stickySectionHeadersEnabled
        // 제목 + 검색/정렬 → 스크롤하면 함께 사라짐
        ListHeaderComponent={
          <View>
            <View style={styles.searchWrap}>
              <View style={styles.searchRow}>
                <View style={{ marginRight: SPACING.sm }}>
                  <SearchIcon size={16} color={COLORS.textTertiary} />
                </View>
                <TextInput
                  style={styles.searchInput}
                  placeholder="공지 검색"
                  placeholderTextColor={COLORS.textTertiary}
                  value={query}
                  onChangeText={(t) => { setQuery(t); setSubmitted(false); }}
                  onFocus={() => { setSearchFocused(true); setSubmitted(false); }}
                  onBlur={() => setSearchFocused(false)}
                  onSubmitEditing={() => { rememberSearch(query); setSubmitted(true); }}
                  returnKeyType="search"
                  clearButtonMode="never"
                />
                {query.length > 0 ? (
                  <TouchableOpacity onPress={() => { setQuery(''); setSubmitted(false); }} hitSlop={8} style={{ paddingLeft: SPACING.sm }} accessibilityRole="button" accessibilityLabel="검색어 지우기">
                    <CloseIcon size={16} color={COLORS.textTertiary} />
                  </TouchableOpacity>
                ) : null}
              </View>
              <PressableScale
                style={styles.sortBtn}
                onPress={cycleSort}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={`정렬: ${SORT_LABELS[sortMode]}. 탭하면 바꿔요`}
              >
                <SortIcon size={18} color={sortMode !== 'deadline' ? COLORS.accent : COLORS.textSecondary} />
              </PressableScale>
            </View>

            {searchFocused && !submitted && (recents.length > 0 || myKeywords.length > 0) ? (
              <Animated.View
                style={styles.suggest}
                entering={FadeInDown.springify().damping(26).stiffness(220).mass(0.5).restDisplacementThreshold(0.5).restSpeedThreshold(2).withInitialValues({ transform: [{ translateY: -8 }] })}
                exiting={FadeOutUp.duration(140).easing(Easing.in(Easing.cubic))}
              >
                {recents.length > 0 ? (
                  <>
                    <View style={styles.suggestHead}>
                      <Text style={styles.suggestTitle}>최근 검색</Text>
                      <TouchableOpacity onPress={() => { clearRecentSearches(); setRecents([]); }} hitSlop={8}>
                        <Text style={styles.suggestClear}>전체 삭제</Text>
                      </TouchableOpacity>
                    </View>
                    <View style={styles.suggestChips}>
                      {recents.map((q) => (
                        <TouchableOpacity key={q} style={styles.suggestChip} onPress={() => { setQuery(q); rememberSearch(q); setSubmitted(true); }} accessibilityRole="button">
                          <Text style={styles.suggestChipText} numberOfLines={1}>{q}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </>
                ) : null}
                {myKeywords.length > 0 ? (
                  <>
                    <Text style={[styles.suggestTitle, { marginTop: recents.length ? SPACING.md : 0, marginBottom: SPACING.sm }]}>내 키워드</Text>
                    <View style={styles.suggestChips}>
                      {myKeywords.map((k) => (
                        <TouchableOpacity key={k} style={[styles.suggestChip, styles.kwSuggestChip]} onPress={() => { setQuery(k); rememberSearch(k); setSubmitted(true); }} accessibilityRole="button">
                          <Text style={[styles.suggestChipText, { color: COLORS.accentText }]} numberOfLines={1}>#{k}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </>
                ) : null}
              </Animated.View>
            ) : null}
          </View>
        }
        // 필터 칩(스크롤) + 정렬 칩(우측 고정) → 상단 고정(sticky). 검색 중엔 숨김.
        renderSectionHeader={() =>
          query ? null : (
            <View style={styles.filterRow}>
              <CategoryChips topics={chipTopics} selected={selected} onSelect={setSelected} />
            </View>
          )
        }
        renderItem={({ item }) => (
          <SwipeToBookmark
            alreadyBookmarked={isBookmarked(item.id)}
            onBookmark={() => onSwipeBookmark(item.id)}
            onAlready={onSwipeAlready}
          >
            <NoticeCard
              notice={item}
              isRead={isRead(item.id)}
              isNew={isNew(item)}
              dimOnPress={false}
              onPress={() => {
                // 검색 중(키보드 올라온 상태)이면 카드 진입 대신 검색을 먼저 취소.
                // (빈 공간을 노려 누르려다 카드가 눌리는 것을 방지 — 표준 '첫 탭은 키보드 닫기')
                if (Keyboard.isVisible()) { Keyboard.dismiss(); return; }
                rememberSearch(query);
                navigation.navigate('Detail', { notice: item });
              }}
            />
          </SwipeToBookmark>
        )}
        ListEmptyComponent={
          searching ? (
            <Text style={styles.empty}>검색 중…</Text>
          ) : query ? (
            <EmptyState
              icon={<SearchIcon size={30} color={COLORS.textTertiary} />}
              title={`'${query}' 검색 결과가 없어요`}
              subtitle="다른 키워드로 찾아보세요"
            />
          ) : (
            <EmptyState
              icon={<ClipboardListIcon size={30} color={COLORS.textTertiary} />}
              title="이 카테고리엔 아직 공지가 없어요"
            />
          )
        }
        ListFooterComponent={
          !query.trim() && loadingMore ? (
            <View style={styles.footer}>
              <ActivityIndicator color={COLORS.accent} />
            </View>
          ) : null
        }
        contentContainerStyle={styles.listContent}
      />

      {showTop ? (
        <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(160)} style={styles.toTop}>
          <TouchableOpacity
            onPress={scrollTop}
            activeOpacity={0.85}
            style={styles.toTopBtn}
            accessibilityRole="button"
            accessibilityLabel="맨 위로"
          >
            <ChevronUpIcon size={22} color={COLORS.accent} />
          </TouchableOpacity>
        </Animated.View>
      ) : null}

    </SafeAreaView>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <SafeAreaView style={[styles.container, styles.centered]}>
      <Text style={{ color: COLORS.textSecondary }}>{children}</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  pageTitle: { ...TEXT.pageTitle, paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm, paddingBottom: SPACING.md },
  centered: { alignItems: 'center', justifyContent: 'center' },
  // 검색바 + 정렬 아이콘 한 줄 (제목 제거로 이게 최상단 → 위 약간 띄움).
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
  },
  searchRow: {
    flex: 1,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.box,
    paddingHorizontal: SPACING.md,
  },
  searchInput: {
    flex: 1,
    fontSize: FONT.body,
    color: COLORS.text,
    padding: 0,
  },
  sortBtn: {
    width: 44,
    height: 44,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.box,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 필터 칩 줄(sticky). 칩 풀폭 + 카드와 간격 확보.
  filterRow: { backgroundColor: COLORS.bg, paddingBottom: SPACING.sm },
  // 검색 제안 패널 (최근 검색 / 내 키워드) — 검색창에서 펼쳐진 드롭다운 카드.
  suggest: {
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.md,
    padding: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.box,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  suggestHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACING.sm },
  suggestTitle: { fontSize: FONT.caption, fontWeight: WEIGHT.bold, color: COLORS.textTertiary },
  suggestClear: { fontSize: FONT.caption, color: COLORS.textTertiary },
  suggestChips: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  suggestChip: {
    maxWidth: 200,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs + 1,
    backgroundColor: COLORS.bg,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  kwSuggestChip: { backgroundColor: COLORS.accentSoft, borderColor: COLORS.accentSoft },
  suggestChipText: { fontSize: FONT.caption, color: COLORS.textSecondary },
  listContent: { paddingBottom: SPACING.xl },
  footer: { paddingVertical: SPACING.lg, alignItems: 'center' },
  // '맨 위로' 플로팅 버튼 (우하단)
  toTop: { position: 'absolute', right: SPACING.lg, bottom: SPACING.xl },
  toTopBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: COLORS.surface,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.border,
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  empty: {
    textAlign: 'center',
    color: COLORS.textSecondary,
    fontSize: FONT.body,
    marginTop: SPACING.xl,
    marginHorizontal: SPACING.lg,
  },
});
