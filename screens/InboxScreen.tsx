import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
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
import { SortToggle } from '../components/ui/SortToggle';
import { NoticeCard } from '../components/NoticeCard';
import { SearchIcon } from '../components/ui/SearchIcon';
import { useReadSet } from '../lib/read';
import { useLastSeenAt, touchLastSeenAt } from '../lib/new-badge';

export default function InboxScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>('전체');
  const [sortMode, setSortMode] = useState<SortMode>('deadline');

  // 검색
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Notice[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 읽음 / NEW
  const { isRead, refresh: refreshRead } = useReadSet();
  const { lastSeenAt } = useLastSeenAt();

  // 탭 포커스 시 읽음 상태 갱신 (다른 화면에서 읽고 돌아올 때)
  useFocusEffect(useCallback(() => { refreshRead(); }, [refreshRead]));

  // 앱 백그라운드 전환 시 last_seen_at 갱신
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') touchLastSeenAt();
    });
    return () => sub.remove();
  }, []);

  // 전체 공지 fetch
  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from('notices')
        .select('*, notice_meta(*), sources(parser_key, name)')
        .order('posted_at', { ascending: false })
        .limit(100);
      if (!active) return;
      if (error) { setError(error.message); setLoading(false); return; }
      setNotices((data ?? []) as Notice[]);
      setLoading(false);
    })();
    return () => { active = false; };
  }, []);

  // 검색 debounce 300ms
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) { setSearchResults([]); setSearching(false); return; }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        // PGroonga RPC 시도
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
          // 폴백: 제목 ilike
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

  const newTodayCount = useMemo(
    () => notices.filter((n) => isPostedToday(n.posted_at)).length,
    [notices]
  );

  const visible = useMemo(() => {
    if (query.trim()) return searchResults;
    const f = selected === '전체' ? notices : notices.filter((n) => metaOf(n)?.topic === selected);
    return sortNotices(f, sortMode);
  }, [notices, selected, sortMode, query, searchResults]);

  if (loading) return <Centered>Loading...</Centered>;
  if (error) return <Centered>Error: {error}</Centered>;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>전체 공지</Text>
        {newTodayCount > 0 && !query ? (
          <Text style={styles.subtitle}>새로운 공지 {newTodayCount}건</Text>
        ) : null}
      </View>

      {/* 검색바 */}
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
          <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}>
            <Text style={styles.clearBtn}>✕</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          query ? null : (
            <View style={styles.listHeader}>
              <SortToggle mode={sortMode} onChange={setSortMode} />
              <CategoryChips topics={CHIP_TOPICS} selected={selected} onSelect={setSelected} />
            </View>
          )
        }
        stickyHeaderIndices={query ? undefined : [0]}
        renderItem={({ item }) => (
          <NoticeCard
            notice={item}
            isRead={isRead(item.id)}
            isNew={isNew(item)}
            onPress={() => navigation.navigate('Detail', { notice: item })}
          />
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {searching ? '검색 중…' : query ? `'${query}' 검색 결과 없음` : '해당 카테고리 공지가 없습니다'}
          </Text>
        }
        contentContainerStyle={styles.listContent}
      />
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
  centered: { alignItems: 'center', justifyContent: 'center' },
  header: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xs,
  },
  title: { fontSize: FONT.display, fontWeight: WEIGHT.bold, color: COLORS.text },
  subtitle: { fontSize: FONT.caption, color: COLORS.textSecondary, marginTop: SPACING.xs },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.box,
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: FONT.body,
    color: COLORS.text,
    padding: 0,
  },
  clearBtn: { fontSize: FONT.caption, color: COLORS.textTertiary, paddingLeft: SPACING.sm },
  listHeader: { backgroundColor: COLORS.bg },
  listContent: { paddingBottom: SPACING.xl },
  empty: {
    textAlign: 'center',
    color: COLORS.textSecondary,
    fontSize: FONT.body,
    marginTop: SPACING.xl,
    marginHorizontal: SPACING.lg,
  },
});
