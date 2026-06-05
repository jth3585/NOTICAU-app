import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AppState, FlatList, Modal, StyleSheet, Text, TextInput,
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
import { SearchIcon } from '../components/ui/SearchIcon';
import { SortIcon } from '../components/ui/SortIcon';
import { useReadSet } from '../lib/read';
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

  // 검색
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Notice[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 읽음 / NEW
  const { isRead, refresh: refreshRead } = useReadSet();
  const { lastSeenAt } = useLastSeenAt();

  useFocusEffect(useCallback(() => { refreshRead(); }, [refreshRead]));

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') touchLastSeenAt();
    });
    return () => sub.remove();
  }, []);

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
    const f = selected === '전체' ? notices : notices.filter((n) => metaOf(n)?.topic === selected);
    return sortNotices(f, sortMode);
  }, [notices, selected, sortMode, query, searchResults]);

  if (loading) return <Centered>Loading...</Centered>;
  if (error) return <Centered>Error: {error}</Centered>;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
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
              <Text style={styles.clearBtn}>✕</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <TouchableOpacity
          style={[styles.sortBtn, sortMode !== 'deadline' && styles.sortBtnActive]}
          onPress={() => setSortSheetOpen(true)}
          hitSlop={6}
        >
          <SortIcon size={18} color={sortMode !== 'deadline' ? COLORS.accent : COLORS.textSecondary} />
        </TouchableOpacity>
      </View>

      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          query ? null : (
            <View style={styles.listHeader}>
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

      {/* 정렬 시트 */}
      <Modal
        visible={sortSheetOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSortSheetOpen(false)}
      >
        <TouchableWithoutFeedback onPress={() => setSortSheetOpen(false)}>
          <View style={styles.overlay}>
            <TouchableWithoutFeedback>
              <View style={styles.sheet}>
                <Text style={styles.sheetTitle}>정렬</Text>
                {(['deadline', 'posted'] as SortMode[]).map((mode) => (
                  <TouchableOpacity
                    key={mode}
                    style={styles.sheetOption}
                    onPress={() => { setSortMode(mode); setSortSheetOpen(false); }}
                  >
                    <Text style={[styles.sheetOptionText, sortMode === mode && styles.sheetOptionActive]}>
                      {SORT_LABELS[mode]}
                    </Text>
                    {sortMode === mode ? <Text style={styles.checkmark}>✓</Text> : null}
                  </TouchableOpacity>
                ))}
              </View>
            </TouchableWithoutFeedback>
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
  clearBtn: { fontSize: FONT.caption, color: COLORS.textTertiary },
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
  // 정렬 시트
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: COLORS.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.xxl,
  },
  sheetTitle: {
    fontSize: FONT.caption,
    fontWeight: WEIGHT.semibold,
    color: COLORS.textTertiary,
    marginBottom: SPACING.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  sheetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  sheetOptionText: {
    fontSize: FONT.body,
    color: COLORS.text,
  },
  sheetOptionActive: {
    color: COLORS.accent,
    fontWeight: WEIGHT.semibold,
  },
  checkmark: {
    fontSize: FONT.body,
    color: COLORS.accent,
    fontWeight: WEIGHT.bold,
  },
});
