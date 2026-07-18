import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { useBookmarkNotices, useUserKeywords, removeBookmark, type BookmarkNotice } from '../lib/bookmarks';
import { useFolders, createFolder, setBookmarkFolder } from '../lib/folders';
import { useReadSet } from '../lib/read';
import { useLastSeenAt } from '../lib/new-badge';
import { lightHaptic } from '../lib/haptics';
import { toast } from '../lib/toast';
import { keywordMatches, firstMatchedKeyword } from '../lib/homeFeed';
import type { RootStackParamList } from '../lib/types';
import { COLORS, FONT, RADIUS, SPACING, WEIGHT } from '../lib/theme';
import { NoticeCard } from '../components/NoticeCard';
import { BookmarkIcon } from '../components/ui/BookmarkIcon';
import { FolderPickerSheet } from '../components/FolderPickerSheet';
import { AddBookmarksModal } from '../components/AddBookmarksModal';
import { SwipeToRemoveBookmark } from '../components/SwipeToRemoveBookmark';
import { BackButton } from '../components/ui/BackButton';
import { NoticeListSkeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';

type Props = NativeStackScreenProps<RootStackParamList, 'BookmarkFolder'>;

const FOLDER_META = {
  unread: { title: '읽지 않음', desc: '북마크 후 아직 확인 안 한 공지' },
  keyword: { title: '키워드 매치', desc: '내 키워드와 맞는 북마크 공지' },
} as const;

export default function BookmarkFolderScreen({ route }: Props) {
  const params = route.params;
  const folder = params.folder;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  // edges=['top']이라 하단은 내비바 뒤로 흐름 → 리스트 끝 여백에 insets.bottom 반영
  const insets = useSafeAreaInsets();
  const { notices, loading, refresh } = useBookmarkNotices();
  const { isRead, refresh: refreshRead } = useReadSet();
  const { lastSeenAt } = useLastSeenAt();
  const keywords = useUserKeywords();
  const { folders, refresh: refreshFolders } = useFolders();
  const [selectedKeyword, setSelectedKeyword] = useState<string | null>(null);
  const [pickerNotice, setPickerNotice] = useState<BookmarkNotice | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());

  const onRemoveBookmark = useCallback((id: string) => {
    lightHaptic();
    toast('북마크에서 삭제했어요');
    // 스와이프 스프링백이 보인 뒤 제거 (북마크 추가와 동일한 감)
    setTimeout(() => {
      setRemovedIds((prev) => new Set(prev).add(id));
      removeBookmark(id).then(() => refresh());
    }, 300);
  }, [refresh]);

  const isCustom = folder === 'custom';
  const customFolderId = params.folder === 'custom' ? params.folderId : null;

  useFocusEffect(useCallback(() => {
    refresh(); refreshRead(); refreshFolders();
  }, [refresh, refreshRead, refreshFolders]));

  const folderNameOf = useCallback(
    (id: string | null) => folders.find((f) => f.id === id)?.name ?? null,
    [folders],
  );

  const onPickFolder = useCallback(async (folderId: string | null) => {
    const target = pickerNotice;
    setPickerNotice(null);
    if (!target) return;
    await setBookmarkFolder(target.id, folderId);
    refresh();
  }, [pickerNotice, refresh]);

  const onCreateFromPicker = useCallback(async (name: string) => {
    const res = await createFolder(name);
    if (res.ok) refreshFolders();
    return res.ok ? { ok: true as const, folderId: res.folder?.id } : { ok: false as const, error: res.error };
  }, [refreshFolders]);

  const onAddToFolder = useCallback(async (noticeId: string) => {
    if (!customFolderId) return;
    await setBookmarkFolder(noticeId, customFolderId);
    refresh();
  }, [customFolderId, refresh]);

  const meta =
    folder === 'custom'
      ? { title: params.folderName, desc: '내가 만든 폴더' }
      : FOLDER_META[folder];

  const list = useMemo(() => {
    const avail = notices.filter((n) => !removedIds.has(n.id)); // optimistic 삭제 반영
    if (folder === 'custom') {
      return avail.filter((n) => n.bookmark_folder_id === params.folderId);
    }
    if (folder === 'unread') return avail.filter((n) => !isRead(n.id));
    // keyword 폴더
    const matched = keywords.length ? avail.filter((n) => keywordMatches(n, keywords)) : [];
    if (!selectedKeyword) return matched;
    const kw = [{ id: '', user_id: '', keyword: selectedKeyword, notify: false }];
    return matched.filter((n) => keywordMatches(n, kw));
  }, [folder, params, notices, removedIds, isRead, keywords, selectedKeyword]);

  const emptyText =
    folder === 'custom' ? '이 폴더에 북마크가 없어요'
    : folder === 'unread' ? '안 읽은 북마크가 없어요'
    : '키워드에 맞는 북마크가 없어요';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <BackButton onPress={() => navigation.goBack()} />
        <Text style={styles.title}>{meta.title}</Text>
        <Text style={styles.desc}>{meta.desc}</Text>
        {isCustom ? (
          <TouchableOpacity style={styles.addBtn} onPress={() => setAddOpen(true)} activeOpacity={0.7}>
            <Text style={styles.addBtnText}>＋ 북마크 담기</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {folder === 'keyword' && keywords.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipsScroll}
          contentContainerStyle={styles.chips}
        >
          <Chip label="전체" active={selectedKeyword === null} onPress={() => setSelectedKeyword(null)} />
          {keywords.map((k) => (
            <Chip
              key={k.id}
              label={`#${k.keyword}`}
              active={selectedKeyword === k.keyword}
              onPress={() => setSelectedKeyword((cur) => (cur === k.keyword ? null : k.keyword))}
            />
          ))}
          <TouchableOpacity
            style={styles.addChip}
            onPress={() => navigation.navigate('KeywordManage')}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="키워드 추가"
          >
            <Text style={styles.addChipText}>＋ 키워드</Text>
          </TouchableOpacity>
        </ScrollView>
      ) : null}

      {loading ? (
        <NoticeListSkeleton count={5} />
      ) : folder === 'keyword' && keywords.length === 0 ? (
        // 등록된 키워드가 아예 없을 때 — 키워드 관리로 유도
        <EmptyState
          icon={<BookmarkIcon size={30} filled={false} color={COLORS.accent} />}
          title="등록된 키워드가 없어요"
          subtitle="관심 키워드를 추가하면 매칭 북마크를 모아드려요"
          actionLabel="키워드 추가하러 가기"
          onAction={() => navigation.navigate('KeywordManage')}
        />
      ) : list.length === 0 ? (
        <EmptyState
          icon={<BookmarkIcon size={30} filled={false} color={COLORS.accent} />}
          title={emptyText}
        />
      ) : (
        <FlashList
          data={list}
          keyExtractor={(n) => n.id}
          contentContainerStyle={{ paddingBottom: SPACING.xxl + insets.bottom }}
          renderItem={({ item }: { item: BookmarkNotice }) => (
            <SwipeToRemoveBookmark onRemove={() => onRemoveBookmark(item.id)}>
              <NoticeCard
                notice={item}
                isRead={isRead(item.id)}
                isNew={!isRead(item.id) && !!lastSeenAt && (item.posted_at ?? '') > lastSeenAt}
                unread={!isRead(item.id)}
                dimOnPress={false}
                keywordTag={folder === 'keyword' ? (firstMatchedKeyword(item, keywords) ?? undefined) : undefined}
                onPress={() => navigation.navigate('Detail', { notice: item, source: 'bookmark' })}
                onLongPress={() => setPickerNotice(item)}
              />
            </SwipeToRemoveBookmark>
          )}
        />
      )}

      <FolderPickerSheet
        visible={pickerNotice !== null}
        folders={folders}
        currentFolderId={pickerNotice?.bookmark_folder_id ?? null}
        onPick={onPickFolder}
        onCreate={onCreateFromPicker}
        onClose={() => setPickerNotice(null)}
      />
      {isCustom ? (
        <AddBookmarksModal
          visible={addOpen}
          candidates={notices.filter((n) => n.bookmark_folder_id !== customFolderId)}
          folderNameOf={folderNameOf}
          onAdd={onAddToFolder}
          onClose={() => setAddOpen(false)}
        />
      ) : null}
    </SafeAreaView>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.chip, active && styles.chipActive]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.xs, paddingBottom: SPACING.md },
  back: { paddingVertical: SPACING.xs, marginBottom: SPACING.xs },
  backText: { fontSize: FONT.body, color: COLORS.textSecondary, fontWeight: WEIGHT.semibold },
  title: { fontSize: FONT.display, fontWeight: WEIGHT.bold, color: COLORS.text },
  desc: { fontSize: FONT.caption, color: COLORS.textSecondary, marginTop: 2 },
  addBtn: {
    alignSelf: 'flex-start', marginTop: SPACING.sm,
    backgroundColor: COLORS.accentSoft, borderRadius: RADIUS.pill,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs,
  },
  addBtnText: { fontSize: FONT.caption, color: COLORS.accentText, fontWeight: WEIGHT.semibold },
  chipsScroll: { flexGrow: 0 },
  chips: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md, gap: SPACING.sm, alignItems: 'center' },
  chip: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surface,
    // ＋키워드(점선 테두리 1px) 버튼과 높이를 맞추기 위한 투명 테두리
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipActive: { backgroundColor: COLORS.accent },
  chipText: { fontSize: FONT.caption, color: COLORS.textSecondary, fontWeight: WEIGHT.semibold },
  chipTextActive: { color: '#fff' },
  // 점선 테두리 '＋ 키워드' 추가 칩 → 키워드 관리로.
  // 테두리는 연한 border 색(새 폴더 점선 박스와 동일 톤)으로 시각 무게를 낮춰
  // 옆 칩들보다 커 보이지 않게 한다.
  addChip: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
  },
  addChipText: { fontSize: FONT.caption, fontWeight: WEIGHT.semibold, color: COLORS.textTertiary },
  ctaBtn: {
    marginTop: SPACING.xs,
    backgroundColor: COLORS.accent,
    borderRadius: RADIUS.pill,
    paddingVertical: SPACING.sm + 2,
    paddingHorizontal: SPACING.xl,
  },
  ctaText: { fontSize: FONT.caption, fontWeight: WEIGHT.bold, color: '#fff' },
  // 카드는 자체 marginHorizontal(lg)을 가지므로 리스트에 가로 패딩을 또 주지 않음(중복 시 다른 화면보다 좁아짐)
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: SPACING.sm, paddingHorizontal: SPACING.xl },
  emptyTitle: { fontSize: FONT.subtitle, fontWeight: WEIGHT.semibold, color: COLORS.text },
  sub: { fontSize: FONT.caption, color: COLORS.textSecondary, textAlign: 'center' },
});
