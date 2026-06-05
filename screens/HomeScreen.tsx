import { useCallback } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useDigest } from '../lib/digest';
import { useReadSet } from '../lib/read';
import { useLastSeenAt } from '../lib/new-badge';
import { NoticeCard } from '../components/NoticeCard';
import type { RootStackParamList } from '../lib/types';
import { COLORS, FONT, SPACING, WEIGHT } from '../lib/theme';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const { notices, loading, refresh } = useDigest();
  const { isRead, refresh: refreshRead } = useReadSet();
  const { lastSeenAt } = useLastSeenAt();

  // 탭 포커스 시 읽음 상태 갱신 + 다이제스트 재계산
  useFocusEffect(useCallback(() => {
    refreshRead();
    refresh();
  }, [refresh, refreshRead]));

  const isNew = useCallback((postedAt: string | null) => {
    if (!lastSeenAt || !postedAt) return false;
    return postedAt > lastSeenAt;
  }, [lastSeenAt]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {notices.length === 0 && !loading ? (
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>✨</Text>
          <Text style={styles.emptyTitle}>오늘 다 확인했어요</Text>
          <Text style={styles.emptySub}>전체 공지에서 더 둘러볼 수 있어요</Text>
          <TouchableOpacity
            style={styles.linkBtn}
            onPress={() => (navigation as any).navigate('Tabs', { screen: 'Feed' })}
          >
            <Text style={styles.linkBtnText}>전체 공지 보기 →</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={notices}
          keyExtractor={n => n.id}
          ListHeaderComponent={<Text style={styles.header}>오늘의 공지</Text>}
          renderItem={({ item }) => (
            <NoticeCard
              notice={item}
              isRead={isRead(item.id)}
              isNew={isNew(item.posted_at)}
              onPress={() => navigation.navigate('Detail', { notice: item })}
            />
          )}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={refresh} tintColor={COLORS.accent} />
          }
          contentContainerStyle={styles.list}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: { fontSize: FONT.display, fontWeight: WEIGHT.bold, color: COLORS.text, paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm, paddingBottom: SPACING.md },
  list: { paddingBottom: SPACING.xxl },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: SPACING.sm, paddingHorizontal: SPACING.xl },
  emptyIcon: { fontSize: 40 },
  emptyTitle: { fontSize: FONT.subtitle, fontWeight: WEIGHT.bold, color: COLORS.text },
  emptySub: { fontSize: FONT.body, color: COLORS.textSecondary, textAlign: 'center' },
  linkBtn: { marginTop: SPACING.sm },
  linkBtnText: { fontSize: FONT.body, color: COLORS.accentText, fontWeight: WEIGHT.semibold },
});
