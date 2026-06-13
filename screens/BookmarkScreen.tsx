import { useCallback } from 'react';
import { Alert, FlatList, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useBookmarkNotices, useUserKeywords } from '../lib/bookmarks';
import { useReadSet } from '../lib/read';
import { useLastSeenAt } from '../lib/new-badge';
import { keywordMatches } from '../lib/homeFeed';
import type { RootStackParamList } from '../lib/types';
import { COLORS, FONT, RADIUS, SPACING, WEIGHT } from '../lib/theme';
import { NoticeCard } from '../components/NoticeCard';
import { BookmarkIcon } from '../components/ui/BookmarkIcon';
import { FolderIcon, HashIcon, MailIcon } from '../components/ui/icons';

export default function BookmarkScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { notices, loading, refresh } = useBookmarkNotices();
  const { isRead, refresh: refreshRead } = useReadSet();
  const { lastSeenAt } = useLastSeenAt();
  const keywords = useUserKeywords();

  useFocusEffect(useCallback(() => { refresh(); refreshRead(); }, [refresh, refreshRead]));

  const unreadCount = notices.filter((n) => !isRead(n.id)).length;
  const keywordCount = keywords.length ? notices.filter((n) => keywordMatches(n, keywords)).length : 0;

  const onCustomPress = () =>
    Alert.alert('준비 중', '커스텀 폴더는 곧 추가될 기능이에요.');

  const Header = (
    <View>
      <View style={styles.collectionRow}>
        <Text style={styles.collectionTitle}>내 컬렉션</Text>
        <TouchableOpacity onPress={onCustomPress} hitSlop={10} activeOpacity={0.7}>
          <Text style={styles.plus}>＋</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.folderRow}
      >
        <FolderCard
          Icon={FolderIcon}
          name="커스텀 폴더"
          caption="준비 중"
          disabled
          onPress={onCustomPress}
        />
        <FolderCard
          Icon={HashIcon}
          name="키워드 매치"
          caption={`${keywordCount}개`}
          onPress={() => navigation.navigate('BookmarkFolder', { folder: 'keyword' })}
        />
        <FolderCard
          Icon={MailIcon}
          name="읽지 않음"
          caption={`${unreadCount}개`}
          onPress={() => navigation.navigate('BookmarkFolder', { folder: 'unread' })}
        />
      </ScrollView>

      <Text style={styles.sectionTitle}>최근 추가 북마크</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>북마크</Text>
      </View>
      <FlatList
        data={notices}
        keyExtractor={(n) => n.id}
        ListHeaderComponent={Header}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          loading ? (
            <View style={styles.empty}>
              <Text style={styles.sub}>불러오는 중…</Text>
            </View>
          ) : (
            <View style={styles.empty}>
              <BookmarkIcon size={40} filled={false} color={COLORS.textTertiary} />
              <Text style={styles.emptyTitle}>아직 북마크한 공지가 없어요</Text>
              <View style={styles.emptyHint}>
                <Text style={styles.sub}>공지 상세 화면에서 </Text>
                <BookmarkIcon size={14} filled={false} color={COLORS.textSecondary} />
                <Text style={styles.sub}> 아이콘을 눌러보세요.</Text>
              </View>
            </View>
          )
        }
        renderItem={({ item }) => (
          <NoticeCard
            notice={item}
            isRead={isRead(item.id)}
            isNew={!isRead(item.id) && !!lastSeenAt && (item.posted_at ?? '') > lastSeenAt}
            unread={!isRead(item.id)}
            onPress={() => navigation.navigate('Detail', { notice: item })}
          />
        )}
      />
    </SafeAreaView>
  );
}

function FolderCard({
  Icon, name, caption, onPress, disabled = false,
}: {
  Icon: (props: { size?: number; color: string }) => React.ReactElement;
  name: string; caption: string; onPress: () => void; disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.folderCard, disabled && styles.folderCardDisabled]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.folderIcon}>
        <Icon size={22} color={disabled ? COLORS.textTertiary : COLORS.accent} />
      </View>
      <Text style={[styles.folderName, disabled && styles.folderTextDim]} numberOfLines={1}>{name}</Text>
      <Text style={[styles.folderCaption, disabled && styles.folderTextDim]}>{caption}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: { paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md },
  title: { fontSize: FONT.display, fontWeight: WEIGHT.bold, color: COLORS.text },
  collectionRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg, marginBottom: SPACING.md,
  },
  collectionTitle: { fontSize: FONT.title, fontWeight: WEIGHT.bold, color: COLORS.text },
  plus: { fontSize: 24, color: COLORS.accent, fontWeight: WEIGHT.bold, lineHeight: 26 },
  folderRow: { flexDirection: 'row', gap: SPACING.md, paddingHorizontal: SPACING.lg },
  folderCard: {
    width: 130,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.card,
    padding: SPACING.lg,
    gap: SPACING.xs,
  },
  folderCardDisabled: { backgroundColor: COLORS.surface, opacity: 0.5 },
  folderIcon: { marginBottom: SPACING.xs },
  emptyHint: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' },
  folderName: { fontSize: FONT.body, fontWeight: WEIGHT.semibold, color: COLORS.text },
  folderCaption: { fontSize: FONT.caption, color: COLORS.textSecondary },
  folderTextDim: { color: COLORS.textTertiary },
  sectionTitle: {
    fontSize: FONT.subtitle, fontWeight: WEIGHT.bold, color: COLORS.text,
    paddingHorizontal: SPACING.lg, marginTop: SPACING.xl, marginBottom: SPACING.md,
  },
  list: { paddingBottom: SPACING.xxl },
  empty: { alignItems: 'center', gap: SPACING.sm, paddingHorizontal: SPACING.xl, paddingTop: SPACING.xxl },
  emptyTitle: { fontSize: FONT.subtitle, fontWeight: WEIGHT.semibold, color: COLORS.text },
  sub: { fontSize: FONT.caption, color: COLORS.textSecondary, textAlign: 'center' },
});
