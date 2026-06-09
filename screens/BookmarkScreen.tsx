import { useCallback, useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabase } from '../lib/supabase';
import { useBookmarkList } from '../lib/bookmarks';
import { useReadSet } from '../lib/read';
import { useLastSeenAt } from '../lib/new-badge';
import type { Notice, RootStackParamList } from '../lib/types';
import { COLORS, FONT, RADIUS, SPACING, WEIGHT } from '../lib/theme';
import { NoticeCard } from '../components/NoticeCard';
import { BookmarkIcon } from '../components/ui/BookmarkIcon';

export default function BookmarkScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { bookmarkIds, loading: idsLoading, refresh } = useBookmarkList();
  const { isRead, refresh: refreshRead } = useReadSet();
  const { lastSeenAt } = useLastSeenAt();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [fetching, setFetching] = useState(false);
  // 최초 1회 로드 여부. 이후 포커스 갱신은 기존 목록을 유지한 채 백그라운드로만 처리(stale-while-revalidate).
  const [loadedOnce, setLoadedOnce] = useState(false);

  // 탭 포커스 시 목록 새로고침
  useFocusEffect(useCallback(() => { refresh(); refreshRead(); }, [refresh, refreshRead]));

  useEffect(() => {
    if (idsLoading) return;
    if (bookmarkIds.length === 0) { setNotices([]); setLoadedOnce(true); return; }
    setFetching(true);
    supabase
      .from('notices')
      .select('*, notice_meta(*), sources(parser_key, name)')
      .in('id', bookmarkIds)
      .order('posted_at', { ascending: false })
      .then(({ data }) => {
        setNotices((data as Notice[]) ?? []);
        setFetching(false);
        setLoadedOnce(true);
      });
  }, [bookmarkIds, idsLoading]);

  // 풀스크린 로더는 첫 로드에만. 재포커스 갱신 중엔 기존 notices를 그대로 보여줌.
  const loading = !loadedOnce && (idsLoading || fetching);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>북마크</Text>
      </View>
      {loading ? (
        <View style={styles.center}>
          <Text style={styles.sub}>불러오는 중…</Text>
        </View>
      ) : notices.length === 0 ? (
        <View style={styles.center}>
          <BookmarkIcon size={40} filled={false} color={COLORS.textTertiary} />
          <Text style={styles.emptyTitle}>아직 북마크한 공지가 없어요</Text>
          <Text style={styles.sub}>공지 상세 화면에서 🔖 아이콘을 눌러보세요.</Text>
        </View>
      ) : (
        <FlatList
          data={notices}
          keyExtractor={(n) => n.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
              <NoticeCard
                notice={item}
                isRead={isRead(item.id)}
                isNew={!isRead(item.id) && !!lastSeenAt && (item.posted_at ?? '') > lastSeenAt}
                onPress={() => navigation.navigate('Detail', { notice: item })}
              />
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: { paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md },
  title: { fontSize: FONT.display, fontWeight: WEIGHT.bold, color: COLORS.text },
  list: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xxl },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: SPACING.sm, paddingHorizontal: SPACING.xl },
  emptyIcon: { fontSize: 40 },
  emptyTitle: { fontSize: FONT.subtitle, fontWeight: WEIGHT.semibold, color: COLORS.text },
  sub: { fontSize: FONT.caption, color: COLORS.textSecondary, textAlign: 'center' },
});
