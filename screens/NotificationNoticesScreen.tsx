import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import type { Notice, RootStackParamList } from '../lib/types';
import {
  fetchNotification, fetchNoticesByIds, markNotificationRead, formatNotifTime, type AppNotification,
} from '../lib/notifications';
import { useReadSet } from '../lib/read';
import { COLORS, FONT, RADIUS, SPACING, TEXT, WEIGHT } from '../lib/theme';
import { NoticeCard } from '../components/NoticeCard';
import { BackButton } from '../components/ui/BackButton';
import { EmptyState } from '../components/ui/EmptyState';
import { NoticeListSkeleton } from '../components/ui/Skeleton';
import { BellIcon } from '../components/ui/icons';

type Props = NativeStackScreenProps<RootStackParamList, 'NotificationNotices'>;

// 알림 하나(예: "키워드 'AI' 매칭 공지 2개", "오늘 새 공지 12건")에 묶인 공지만 모아 보여준다.
export default function NotificationNoticesScreen({ route }: Props) {
  const { notificationId } = route.params;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { isRead, refresh: refreshRead } = useReadSet();
  const [notif, setNotif] = useState<AppNotification | null>(null);
  const [notices, setNotices] = useState<Notice[] | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const n = await fetchNotification(notificationId);
      if (!alive) return;
      if (!n) { setMissing(true); setNotices([]); return; }
      setNotif(n);
      if (!n.read_at) markNotificationRead(n.id);
      const list = await fetchNoticesByIds(n.notice_ids);
      if (alive) setNotices(list);
    })();
    return () => { alive = false; };
  }, [notificationId]);

  // 상세에서 돌아오면 읽음 표시 갱신
  useFocusEffect(useCallback(() => { refreshRead(); }, [refreshRead]));

  const keywords = Array.isArray(notif?.data?.keywords) ? (notif!.data.keywords as string[]) : [];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <BackButton onPress={() => navigation.goBack()} />
        <Text style={styles.title} numberOfLines={2}>{notif?.body ?? '알림'}</Text>
        {notif ? (
          <Text style={styles.desc}>{notif.title} · {formatNotifTime(notif.created_at)}</Text>
        ) : null}
        {keywords.length > 0 ? (
          <View style={styles.tags}>
            {keywords.map((k) => (
              <View key={k} style={styles.tag}><Text style={styles.tagText}>#{k}</Text></View>
            ))}
          </View>
        ) : null}
      </View>

      {notices === null ? (
        <NoticeListSkeleton count={4} />
      ) : notices.length === 0 ? (
        <EmptyState
          icon={<BellIcon size={30} color={COLORS.accent} />}
          title={missing ? '지난 알림이에요' : '볼 수 있는 공지가 없어요'}
          subtitle={missing ? '알림은 14일 동안 보관돼요' : '공지가 삭제되었거나 더 이상 표시되지 않아요'}
        />
      ) : (
        <FlashList
          data={notices}
          keyExtractor={(n) => n.id}
          contentContainerStyle={{ paddingBottom: SPACING.xxl + insets.bottom }}
          renderItem={({ item }: { item: Notice }) => (
            <NoticeCard
              notice={item}
              isRead={isRead(item.id)}
              unread={!isRead(item.id)}
              onPress={() => navigation.navigate('Detail', { notice: item, source: `notif_${notif?.type ?? 'unknown'}` })}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.xs, paddingBottom: SPACING.md },
  title: { ...TEXT.pageTitle },
  desc: { fontSize: FONT.caption, color: COLORS.textSecondary, marginTop: 2 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, marginTop: SPACING.sm },
  tag: {
    backgroundColor: COLORS.accentSoft, borderRadius: RADIUS.pill,
    paddingHorizontal: SPACING.sm, paddingVertical: 2,
  },
  tagText: { fontSize: FONT.caption, fontWeight: WEIGHT.semibold, color: COLORS.accentText },
});
