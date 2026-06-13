import { useCallback } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useDigest } from '../lib/digest';
import { useHomeFeed } from '../lib/homeFeed';
import { useLastSeenAt } from '../lib/new-badge';
import { HomeGreeting } from '../components/HomeGreeting';
import { HomeFilterTabs } from '../components/HomeFilterTabs';
import { HomeCuration } from '../components/HomeCuration';
import type { Notice, RootStackParamList } from '../lib/types';
import { COLORS, SPACING } from '../lib/theme';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const feed = useHomeFeed();
  const {
    notices: digestNotices, loading: digestLoading, loadingMore, allSeen,
    refresh: digestRefresh, loadMore, syncReadIds,
  } = useDigest();
  const { lastSeenAt } = useLastSeenAt();

  // 탭 포커스 시 읽음 상태 재동기 + 호칭 재조회 (프로필 수정 즉시 반영, 캐시 유지)
  useFocusEffect(useCallback(() => { syncReadIds(); feed.refreshProfile(); }, [syncReadIds, feed.refreshProfile]));

  const isNew = useCallback((postedAt: string | null) => {
    if (!lastSeenAt || !postedAt) return false;
    return postedAt > lastSeenAt;
  }, [lastSeenAt]);

  const onRefresh = useCallback(async () => {
    await Promise.all([feed.refresh(), digestRefresh()]);
  }, [feed, digestRefresh]);

  const onPressNotice = useCallback((n: Notice) => {
    navigation.navigate('Detail', { notice: n });
  }, [navigation]);

  if (feed.loading || digestLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}><ActivityIndicator color={COLORS.accent} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={feed.refreshing} onRefresh={onRefresh} tintColor={COLORS.accent} />}
      >
        <HomeGreeting
          nickname={feed.nickname}
          deadlineSoonCount={feed.deadlineSoonCount}
          newCount={feed.newCount}
        />
        <HomeFilterTabs
          newList={feed.newList}
          keywordList={feed.keywordList}
          deadlineList={feed.deadlineList}
          keywords={feed.keywords}
          onPressNotice={onPressNotice}
        />
        <HomeCuration
          notices={digestNotices}
          loadingMore={loadingMore}
          allSeen={allSeen}
          onLoadMore={loadMore}
          onPressNotice={onPressNotice}
          isNew={isNew}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { paddingBottom: SPACING.xxl },
});
