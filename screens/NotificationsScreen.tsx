import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, SectionList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../lib/types';
import {
  fetchNotifications, markAllNotificationsRead, markNotificationRead,
  formatNotifTime, notifGroupLabel, type AppNotification,
} from '../lib/notifications';
import { fetchNoticeById } from '../lib/notices';
import { COLORS, FONT, RADIUS, SPACING, TEXT, WEIGHT } from '../lib/theme';
import { BackButton } from '../components/ui/BackButton';
import { EmptyState } from '../components/ui/EmptyState';
import { NoticeListSkeleton } from '../components/ui/Skeleton';
import { BellIcon, CalendarIcon, ClipboardListIcon, HashIcon } from '../components/ui/icons';

type Nav = NativeStackNavigationProp<RootStackParamList>;

// 알림 종류별 아이콘. 타입이 늘면 여기에 추가.
function TypeIcon({ type }: { type: string }) {
  if (type === 'keyword') return <HashIcon size={18} color={COLORS.accent} />;
  if (type === 'digest') return <ClipboardListIcon size={18} color={COLORS.accent} />;
  if (type === 'event') return <CalendarIcon size={18} color={COLORS.accent} />;
  return <BellIcon size={18} color={COLORS.accent} />;
}

export default function NotificationsScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setItems(await fetchNotifications());
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const sections = useMemo(() => {
    const groups = new Map<string, AppNotification[]>();
    for (const n of items ?? []) {
      const label = notifGroupLabel(n.created_at);
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label)!.push(n);
    }
    return [...groups.entries()].map(([title, data]) => ({ title, data }));
  }, [items]);

  const hasUnread = (items ?? []).some((n) => !n.read_at);

  const onReadAll = useCallback(async () => {
    const now = new Date().toISOString();
    setItems((prev) => prev?.map((n) => (n.read_at ? n : { ...n, read_at: now })) ?? prev);
    await markAllNotificationsRead();
  }, []);

  const onPressItem = useCallback(async (n: AppNotification) => {
    if (!n.read_at) {
      const now = new Date().toISOString();
      setItems((prev) => prev?.map((x) => (x.id === n.id ? { ...x, read_at: now } : x)) ?? prev);
      markNotificationRead(n.id);
    }
    // 공지 1건이면 바로 상세, 여러 건이면 그 알림의 공지 모음
    if (n.notice_ids.length === 1) {
      const notice = await fetchNoticeById(n.notice_ids[0]);
      if (notice) {
        navigation.navigate('Detail', { notice, source: `notif_${n.type}` });
        return;
      }
    }
    navigation.navigate('NotificationNotices', { notificationId: n.id });
  }, [navigation]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <BackButton onPress={() => navigation.goBack()} />
        <View style={styles.titleRow}>
          <Text style={styles.title}>알림</Text>
          {hasUnread ? (
            <TouchableOpacity onPress={onReadAll} hitSlop={8} activeOpacity={0.6} accessibilityRole="button">
              <Text style={styles.readAll}>모두 읽음</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {items === null ? (
        <NoticeListSkeleton count={5} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<BellIcon size={30} color={COLORS.accent} />}
          title="아직 받은 알림이 없어요"
          subtitle="키워드 알림, 내 학과 새 행사, 매일 저녁 공지 브리핑이 여기에 모여요"
          actionLabel="키워드 설정하러 가기"
          onAction={() => navigation.navigate('KeywordManage')}
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(n) => n.id}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={{ paddingBottom: SPACING.xxl + insets.bottom }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.accent} colors={[COLORS.accent]} />}
          renderSectionHeader={({ section }) => <Text style={styles.sectionLabel}>{section.title}</Text>}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.row, !item.read_at && styles.rowUnread]}
              onPress={() => onPressItem(item)}
              activeOpacity={0.6}
              accessibilityRole="button"
              accessibilityLabel={`${item.title}, ${item.body}${item.read_at ? '' : ', 읽지 않음'}`}
            >
              <View style={styles.iconWrap}>
                <TypeIcon type={item.type} />
              </View>
              <View style={styles.rowBody}>
                <View style={styles.rowTop}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{item.title}</Text>
                  <Text style={styles.rowTime}>{formatNotifTime(item.created_at)}</Text>
                </View>
                <Text style={[styles.rowText, !item.read_at && styles.rowTextUnread]} numberOfLines={2}>
                  {item.body}
                </Text>
              </View>
              {!item.read_at ? <View style={styles.dot} /> : null}
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.xs, paddingBottom: SPACING.md },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...TEXT.pageTitle },
  readAll: { fontSize: FONT.caption, fontWeight: WEIGHT.semibold, color: COLORS.accentText },
  sectionLabel: {
    ...TEXT.sectionLabel,
    paddingHorizontal: SPACING.lg, paddingTop: SPACING.lg, paddingBottom: SPACING.sm,
  },
  row: {
    flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.md,
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md,
  },
  rowUnread: { backgroundColor: COLORS.accentSoft },
  iconWrap: {
    width: 36, height: 36, borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center',
  },
  rowBody: { flex: 1, gap: 2 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACING.sm },
  rowTitle: { flexShrink: 1, fontSize: FONT.caption, fontWeight: WEIGHT.semibold, color: COLORS.textSecondary },
  rowTime: { fontSize: FONT.micro, color: COLORS.textTertiary },
  rowText: { fontSize: FONT.body, color: COLORS.textSecondary, lineHeight: 21 },
  rowTextUnread: { color: COLORS.text, fontWeight: WEIGHT.semibold },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.danger, marginTop: 6 },
});
