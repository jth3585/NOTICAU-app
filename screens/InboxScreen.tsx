import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AppState, Dimensions, FlatList, Modal, RefreshControl, StyleSheet, Text, TextInput,
  TouchableOpacity, TouchableWithoutFeedback, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useCallback } from 'react';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabase } from '../lib/supabase';
import type { Notice, RootStackParamList } from '../lib/types';
import { CHIP_TOPICS } from '../lib/constants';
import { COLORS, FONT, RADIUS, SPACING, WEIGHT } from '../lib/theme';
import { isPostedToday, metaOf, sortNotices, type SortMode } from '../lib/format';
import { CategoryChips } from '../components/CategoryChips';
import { NoticeCard } from '../components/NoticeCard';
import { SwipeToBookmark } from '../components/SwipeToBookmark';
import { SearchIcon } from '../components/ui/SearchIcon';
import { SortIcon } from '../components/ui/SortIcon';
import { CloseIcon, CheckIcon } from '../components/ui/icons';
import { useReadSet } from '../lib/read';
import { useBookmarkSet, addBookmark } from '../lib/bookmarks';
import { lightHaptic, softHaptic } from '../lib/haptics';
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
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 읽음 / NEW
  const { isRead, refresh: refreshRead } = useReadSet();
  const { isBookmarked, markBookmarked, refresh: refreshBookmarks } = useBookmarkSet();
  const { lastSeenAt } = useLastSeenAt();

  // 스와이프 → 북마크 추가 (토글 아님). 이미 북마크면 피드백만.
  const onSwipeBookmark = useCallback((id: string) => {
    lightHaptic();
    markBookmarked(id); // optimistic
    addBookmark(id);
  }, [markBookmarked]);

  const onSwipeAlready = useCallback(() => {
    softHaptic();
  }, []);

  // 카테고리 OFF 프리프 (topic → false인 것들)
  const [disabledTopics, setDisabledTopics] = useState<Set<string>>(new Set());

  useFocusEffect(useCallback(() => {
    refreshRead();
    refreshBookmarks();
    // 카테고리 프리프 새로고침 (CategoryPrefsScreen에서 변경 후 돌아올 때)
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const { data } = await supabase.from('user_category_prefs')
        .select('topic,is_enabled').eq('user_id', session.user.id);
      const disabled = new Set<string>();
      (data ?? []).forEach((r: any) => { if (!r.is_enabled) disabled.add(r.topic); });
      setDisabledTopics(disabled);
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
      .select('*, notice_meta(*), sources(parser_key, name)')
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
            .select('*, notice_meta(*), sources(parser_key, name)')
            .in('id', (ids as { id: string }[]).map((r) => r.id))
            .order('posted_at', { ascending: false });
          setSearchResults((data ?? []) as Notice[]);
        } else if (!rpcErr) {
          setSearchResults([]);
        } else {
          const { data } = await supabase
            .from('notices')
            .select('*, notice_meta(*), sources(parser_key, name)')
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
    if (query.trim()) return searchResults;
    let f = selected === '전체'
      ? notices.filter((n) => {
          const topic = metaOf(n)?.topic;
          return !topic || !disabledTopics.has(topic);
        })
      : notices.filter((n) => metaOf(n)?.topic === selected);
    return sortNotices(f, sortMode);
  }, [notices, selected, sortMode, query, searchResults, disabledTopics]);

  if (loading) return <Centered>Loading...</Centered>;
  if (error) return <Centered>Error: {error}</Centered>;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Text style={styles.pageTitle}>전체 공지</Text>
      {/* 검색바 + 정렬 아이콘 */}
      <View style={styles.topBar}>
        <View style={styles.searchRow}>
          <View style={{ marginRight: SPACING.sm }}>
            <SearchIcon size={16} color={COLORS.textTertiary} />
          </View>
          <TextInput
            style={styles.searchInput}
            placeholder="공지 검색"
            placeholderTextColor={COLORS.textTertiary}
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
          {query.length > 0 ? (
            <TouchableOpacity onPress={() => setQuery('')} hitSlop={8} style={{ paddingLeft: SPACING.sm }}>
              <CloseIcon size={16} color={COLORS.textTertiary} />
            </TouchableOpacity>
          ) : null}
        </View>

        <TouchableOpacity
          ref={sortBtnRef}
          style={[styles.sortBtn, sortMode !== 'deadline' && styles.sortBtnActive]}
          onPress={openSort}
          hitSlop={6}
        >
          <SortIcon size={18} color={sortMode !== 'deadline' ? COLORS.accent : COLORS.textSecondary} />
        </TouchableOpacity>
      </View>

      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.accent} />
        }
        ListHeaderComponent={
          query ? null : (
            <View style={styles.listHeader}>
              <CategoryChips topics={CHIP_TOPICS} selected={selected} onSelect={setSelected} />
            </View>
          )
        }
        stickyHeaderIndices={query ? undefined : [0]}
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
              onPress={() => navigation.navigate('Detail', { notice: item })}
            />
          </SwipeToBookmark>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {searching ? '검색 중…' : query ? `'${query}' 검색 결과 없음` : '해당 카테고리 공지가 없습니다'}
          </Text>
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
  pageTitle: { fontSize: FONT.display, fontWeight: WEIGHT.bold, color: COLORS.text, paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm, paddingBottom: SPACING.md },
  centered: { alignItems: 'center', justifyContent: 'center' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.sm,
    gap: SPACING.sm,
  },
  searchRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.box,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: FONT.body,
    color: COLORS.text,
    padding: 0,
  },
  sortBtn: {
    width: 40,
    height: 40,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.box,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sortBtnActive: { backgroundColor: COLORS.accentSoft },
  listHeader: { backgroundColor: COLORS.bg },
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
