import { useCallback } from 'react';
import {
  ActivityIndicator, FlatList, RefreshControl,
  StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useDigest } from '../lib/digest';
import { useLastSeenAt } from '../lib/new-badge';
import { NoticeCard } from '../components/NoticeCard';
import type { RootStackParamList } from '../lib/types';
import { COLORS, FONT, RADIUS, SPACING, WEIGHT } from '../lib/theme';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const { notices, loading, loadingMore, allSeen, refresh, loadMore, syncReadIds } = useDigest();
  const { lastSeenAt } = useLastSeenAt();

  // 탭 포커스 시 읽음 상태만 재동기 (캐시 유지)
  useFocusEffect(useCallback(() => {
    syncReadIds();
  }, [syncReadIds]));

  const isNew = useCallback((postedAt: string | null) => {
    if (!lastSeenAt || !postedAt) return false;
    return postedAt > lastSeenAt;
  }, [lastSeenAt]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Text style={styles.header}>오늘의 공지</Text>
        <View style={styles.center}>
          <ActivityIndicator color={COLORS.accent} />
        </View>
      </SafeAreaView>
    );
  }

  if (allSeen) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Text style={styles.header}>오늘의 공지</Text>
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>✨</Text>
          <Text style={styles.emptyTitle}>오늘 다 확인했어요</Text>
          <Text style={styles.emptySub}>매일 아침 새 추천이 준비돼요</Text>
          <TouchableOpacity
            style={styles.moreBtn}
            onPress={loadMore}
            disabled={loadingMore}
          >
            {loadingMore
              ? <ActivityIndicator color={COLORS.accent} />
              : <Text style={styles.moreBtnText}>추천 더보기</Text>
            }
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => (navigation as any).navigate('Tabs', { screen: 'Feed' })}
          >
            <Text style={styles.feedLink}>전체 공지 보기 →</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <FlatList
        data={notices}
        keyExtractor={n => n.id}
        ListHeaderComponent={<Text style={styles.header}>오늘의 공지</Text>}
        renderItem={({ item }) => (
          <NoticeCard
            notice={item}
            isNew={isNew(item.posted_at)}
            onPress={() => navigation.navigate('Detail', { notice: item })}
          />
        )}
        refreshControl={
          <RefreshControl refreshing={false} onRefresh={refresh} tintColor={COLORS.accent} />
        }
        contentContainerStyle={styles.list}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    fontSize: FONT.display, fontWeight: WEIGHT.bold, color: COLORS.text,
    paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm, paddingBottom: SPACING.md,
  },
  list: { paddingBottom: SPACING.xxl },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: SPACING.md, paddingHorizontal: SPACING.xl },
  emptyIcon: { fontSize: 44 },
  emptyTitle: { fontSize: FONT.subtitle, fontWeight: WEIGHT.bold, color: COLORS.text },
  emptySub: { fontSize: FONT.body, color: COLORS.textSecondary, textAlign: 'center' },
  moreBtn: {
    marginTop: SPACING.sm,
    backgroundColor: COLORS.accent,
    borderRadius: RADIUS.card,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.xl,
    minWidth: 140,
    alignItems: 'center',
  },
  moreBtnText: { fontSize: FONT.body, fontWeight: WEIGHT.bold, color: '#fff' },
  feedLink: { fontSize: FONT.body, color: COLORS.accentText, fontWeight: WEIGHT.semibold },
});
