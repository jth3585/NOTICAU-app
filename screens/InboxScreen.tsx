import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AppState, Dimensions, Modal, RefreshControl, SectionList, StyleSheet, Text, TextInput,
  TouchableOpacity, TouchableWithoutFeedback, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useCallback } from 'react';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabase } from '../lib/supabase';
import type { Notice, RootStackParamList } from '../lib/types';
import { CHIP_TOPICS } from '../lib/constants';
import { orderedCategories } from '../lib/categories';
import { COLORS, FONT, RADIUS, SPACING, TEXT, WEIGHT } from '../lib/theme';
import { isPostedToday, metaOf, sourceOf, sortNotices, type SortMode } from '../lib/format';
import { CategoryChips } from '../components/CategoryChips';
import { NoticeCard } from '../components/NoticeCard';
import { SwipeToBookmark } from '../components/SwipeToBookmark';
import { SearchIcon } from '../components/ui/SearchIcon';
import { SortIcon } from '../components/ui/SortIcon';
import { CloseIcon, CheckIcon, ClipboardListIcon } from '../components/ui/icons';
import { EmptyState } from '../components/ui/EmptyState';
import { NoticeListSkeleton } from '../components/ui/Skeleton';
import { useReadSet } from '../lib/read';
import { NOTICE_LIST_SELECT } from '../lib/notices';
import { useBookmarkSet, addBookmark } from '../lib/bookmarks';
import { lightHaptic, softHaptic } from '../lib/haptics';
import { toast } from '../lib/toast';
import { getRecentSearches, addRecentSearch, clearRecentSearches } from '../lib/recentSearches';
import { useLastSeenAt, touchLastSeenAt } from '../lib/new-badge';

const SORT_LABELS: Record<SortMode, string> = {
  deadline: '마감일순',
  posted: '등록일순',
};

export default function InboxScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>('전체');
  const [sortMode, setSortMode] = useState<SortMode>('deadline');
  const [sortSheetOpen, setSortSheetOpen] = useState(false);
  const sortBtnRef = useRef<View>(null);
  // 정렬 버튼을 anchor 삼아 그 아래에 말풍선 팝오버를 띄우기 위한 좌표.
  const [sortAnchor, setSortAnchor] = useState<{ top: number; right: number } | null>(null);

  const openSort = () => {
    sortBtnRef.current?.measureInWindow((x, y, w, h) => {
      setSortAnchor({ top: y + h + 6, right: Dimensions.get('window').width - (x + w) });
      setSortSheetOpen(true);
    });
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
  // 내 캠퍼스 ('seoul' | 'davinci'). 타 캠퍼스 전용 게시판 공지를 전체 공지에서 숨기기 위함.
  const [campus, setCampus] = useState<string | null>(null);

  // 출처(게시판) 캠퍼스 귀속 필터. 'both'(본교)·null·캠퍼스 미확인은 통과.
  const campusAllows = useCallback((n: Notice) => {
    const sc = sourceOf(n)?.campus;
    if (!sc || sc === 'both' || !campus) return true;
    if (sc === campus) return true;
    if (sc === 'anseong' && campus === 'davinci') return true;
    return false;
  }, [campus]);

  useFocusEffect(useCallback(() => {
    refreshRead();
    refreshBookmarks();
    getRecentSearches().then(setRecents);
    // 카테고리 프리프 + 내 키워드 새로고침
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const [prefRes, kwRes, profRes] = await Promise.all([
        supabase.from('user_category_prefs').select('topic,is_enabled,sort_order').eq('user_id', session.user.id),
        supabase.from('user_keywords').select('keyword').eq('user_id', session.user.id),
        supabase.from('profiles').select('campus').eq('user_id', session.user.id).maybeSingle(),
      ]);
      const rows = (prefRes.data ?? []) as any[];
      const disabled = new Set<string>();
      rows.forEach((r) => { if (!r.is_enabled) disabled.add(r.topic); });
      setDisabledTopics(disabled);
      setChipTopics(['전체', ...orderedCategories(rows)]);
      setMyKeywords(((kwRes.data ?? []) as any[]).map((k) => k.keyword));
      setCampus(((profRes.data as any)?.campus) ?? null);
    })();
  }, [refreshRead, refreshBookmarks]));

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') touchLastSeenAt();
    });
    return () => sub.remove();
  }, []);

  const [refreshing, setRefreshing] = useState(false);

  const loadNotices = useCallback(async () => {
    const { data, error } = await supabase
      .from('notices')
      .select(NOTICE_LIST_SELECT)
      .order('posted_at', { ascending: false })
      .limit(100);
    if (error) { setError(error.message); return; }
    setNotices((data ?? []) as Notice[]);
  }, []);

  useEffect(() => {
    (async () => { await loadNotices(); setLoading(false); })();
  }, [loadNotices]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadNotices();
    setRefreshing(false);
  }, [loadNotices]);

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
            .select(NOTICE_LIST_SELECT)
            .in('id', (ids as { id: string }[]).map((r) => r.id))
            .order('posted_at', { ascending: false });
          setSearchResults((data ?? []) as Notice[]);
        } else if (!rpcErr) {
          setSearchResults([]);
        } else {
          const { data } = await supabase
            .from('notices')
            .select(NOTICE_LIST_SELECT)
            .ilike('title', `%${query.trim()}%`)
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

  const visible = useMemo(() => {
    if (query.trim()) return searchResults.filter(campusAllows);
    let f = selected === '전체'
      ? notices.filter((n) => {
          const topic = metaOf(n)?.topic;
          return !topic || !disabledTopics.has(topic);
        })
      : notices.filter((n) => metaOf(n)?.topic === selected);
    return sortNotices(f.filter(campusAllows), sortMode);
  }, [notices, selected, sortMode, query, searchResults, disabledTopics, campusAllows]);

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
        sections={[{ data: visible }]}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.accent} />
        }
        keyboardShouldPersistTaps="handled"
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
              <TouchableOpacity
                ref={sortBtnRef}
                style={[styles.sortBtn, sortMode !== 'deadline' && styles.sortBtnActive]}
                onPress={openSort}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={`정렬: ${SORT_LABELS[sortMode]}`}
              >
                <SortIcon size={18} color={sortMode !== 'deadline' ? COLORS.accent : COLORS.textSecondary} />
              </TouchableOpacity>
            </View>

            {searchFocused && !submitted && (recents.length > 0 || myKeywords.length > 0) ? (
              <View style={styles.suggest}>
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
              </View>
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
              onPress={() => { rememberSearch(query); navigation.navigate('Detail', { notice: item }); }}
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
        contentContainerStyle={styles.listContent}
      />

      {/* 정렬 말풍선 팝오버 (정렬 버튼 anchor 기준) */}
      <Modal
        visible={sortSheetOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSortSheetOpen(false)}
      >
        <TouchableWithoutFeedback onPress={() => setSortSheetOpen(false)}>
          <View style={styles.overlay}>
            {sortAnchor ? (
              <TouchableWithoutFeedback>
                <View style={[styles.popover, { top: sortAnchor.top, right: sortAnchor.right }]}>
                  <View style={styles.caret} />
                  {(['deadline', 'posted'] as SortMode[]).map((mode) => (
                    <TouchableOpacity
                      key={mode}
                      style={styles.popOption}
                      onPress={() => { setSortMode(mode); setSortSheetOpen(false); }}
                      accessibilityRole="button"
                      accessibilityState={{ selected: sortMode === mode }}
                    >
                      <Text style={[styles.popOptionText, sortMode === mode && styles.popOptionActive]}>
                        {SORT_LABELS[mode]}
                      </Text>
                      {sortMode === mode ? <CheckIcon size={16} color={COLORS.accent} /> : null}
                    </TouchableOpacity>
                  ))}
                </View>
              </TouchableWithoutFeedback>
            ) : null}
          </View>
        </TouchableWithoutFeedback>
      </Modal>
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
  sortBtnActive: { backgroundColor: COLORS.accentSoft },
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
  empty: {
    textAlign: 'center',
    color: COLORS.textSecondary,
    fontSize: FONT.body,
    marginTop: SPACING.xl,
    marginHorizontal: SPACING.lg,
  },
  // 정렬 말풍선 팝오버
  overlay: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  popover: {
    position: 'absolute',
    minWidth: 132,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.box,
    paddingVertical: SPACING.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  // 말풍선 꼬리: 45도 회전한 정사각형의 위/왼쪽 테두리만 보여 위를 가리키게.
  caret: {
    position: 'absolute',
    top: -6,
    right: 12,
    width: 12,
    height: 12,
    backgroundColor: COLORS.surface,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    transform: [{ rotate: '45deg' }],
  },
  popOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.md,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
  },
  popOptionText: {
    fontSize: FONT.body,
    color: COLORS.text,
  },
  popOptionActive: {
    color: COLORS.accent,
    fontWeight: WEIGHT.semibold,
  },
});
