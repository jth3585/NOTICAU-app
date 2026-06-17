import { useCallback, useEffect } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useDigest } from '../lib/digest';
import { useHomeFeed } from '../lib/homeFeed';
import { useLastSeenAt } from '../lib/new-badge';
import { HomeGreeting } from '../components/HomeGreeting';
import { HomeFilterTabs } from '../components/HomeFilterTabs';
import { HomeCuration } from '../components/HomeCuration';
import type { Notice, RootStackParamList, TabParamList } from '../lib/types';
import { COLORS, SPACING } from '../lib/theme';

type Nav = NativeStackNavigationProp<RootStackParamList>;

// 상단 소프트 틴트 (블루 → 투명). 상태바+인사말 영역만 은은히 물들이고 필터 탭 전에 사라짐.
const TOP_TINT = ['rgba(74,144,226,0.24)', 'rgba(108,150,235,0.10)', 'transparent'] as const;

export default function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProp<TabParamList, 'Home'>>();
  // 알림 딥링크로 전달된 탭(예: 키워드매치). 한 번 소비 후 비워서 재진입 시 고정되지 않게.
  const requestedTab = route.params?.tab ?? null;
  useEffect(() => {
    if (requestedTab) navigation.setParams({ tab: undefined } as never);
  }, [requestedTab, navigation]);
  const feed = useHomeFeed();
  const {
    notices: digestNotices, loading: digestLoading, allSeen,
    refresh: digestRefresh, syncReadIds, markReadLocal,
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

  // 큐레이션 글을 열면 즉시 로컬 읽음 처리(서버 커밋 타이밍과 무관하게 바로 사라지게).
  const onPressCuration = useCallback((n: Notice) => {
    markReadLocal(n.id);
    navigation.navigate('Detail', { notice: n });
  }, [markReadLocal, navigation]);

  // 추천을 다 읽으면 전체 공지 탭으로 이동.
  const onGoToAll = useCallback(() => {
    navigation.navigate('Feed' as never);
  }, [navigation]);

  if (feed.loading || digestLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}><ActivityIndicator color={COLORS.accent} /></View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.root}>
      <LinearGradient colors={TOP_TINT} style={styles.topTint} pointerEvents="none" />
      <SafeAreaView style={styles.flex} edges={['top']}>
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
          initialTab={requestedTab}
        />
        <HomeCuration
          notices={digestNotices}
          allSeen={allSeen}
          onGoToAll={onGoToAll}
          onPressNotice={onPressCuration}
          isNew={isNew}
        />
      </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  root: { flex: 1, backgroundColor: COLORS.bg },
  flex: { flex: 1 },
  topTint: { position: 'absolute', top: 0, left: 0, right: 0, height: 240 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { paddingBottom: SPACING.xxl },
});
