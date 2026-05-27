import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { supabase } from '../lib/supabase';
import type { Notice, RootStackParamList } from '../lib/types';
import { CHIP_TOPICS } from '../lib/constants';
import { COLORS, FONT, SPACING, WEIGHT } from '../lib/theme';
import { isPostedToday, metaOf, sortNotices, type SortMode } from '../lib/format';
import { CategoryChips } from '../components/CategoryChips';
import { SortToggle } from '../components/ui/SortToggle';
import { NoticeCard } from '../components/NoticeCard';

type Props = NativeStackScreenProps<RootStackParamList, 'Inbox'>;

export default function InboxScreen({ navigation }: Props) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>('전체');
  const [sortMode, setSortMode] = useState<SortMode>('deadline');

  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from('notices')
        .select('*, notice_meta(*), sources(parser_key, name)')
        .order('posted_at', { ascending: false })
        .limit(100);
      if (!active) return;
      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }
      setNotices((data ?? []) as Notice[]);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  const newTodayCount = useMemo(
    () => notices.filter((n) => isPostedToday(n.posted_at)).length,
    [notices]
  );

  const visible = useMemo(() => {
    const f = selected === '전체' ? notices : notices.filter((n) => metaOf(n)?.topic === selected);
    return sortNotices(f, sortMode);
  }, [notices, selected, sortMode]);

  if (loading) return <Centered>Loading...</Centered>;
  if (error) return <Centered>Error: {error}</Centered>;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>전체 공지</Text>
        {newTodayCount > 0 ? (
          <Text style={styles.subtitle}>새로운 공지 {newTodayCount}건</Text>
        ) : null}
      </View>

      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <SortToggle mode={sortMode} onChange={setSortMode} />
            <CategoryChips topics={CHIP_TOPICS} selected={selected} onSelect={setSelected} />
          </View>
        }
        stickyHeaderIndices={[0]}
        renderItem={({ item }) => (
          <NoticeCard
            notice={item}
            onPress={() => navigation.navigate('Detail', { notice: item })}
          />
        )}
        ListEmptyComponent={<Text style={styles.empty}>해당 카테고리 공지가 없습니다</Text>}
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
    paddingBottom: SPACING.sm,
  },
  title: { fontSize: FONT.display, fontWeight: WEIGHT.bold, color: COLORS.text },
  subtitle: { fontSize: FONT.caption, color: COLORS.textSecondary, marginTop: SPACING.xs },
  listHeader: { backgroundColor: COLORS.bg },
  listContent: { paddingBottom: SPACING.xl },
  empty: {
    textAlign: 'center',
    color: COLORS.textSecondary,
    fontSize: FONT.body,
    marginTop: SPACING.xl,
  },
});
