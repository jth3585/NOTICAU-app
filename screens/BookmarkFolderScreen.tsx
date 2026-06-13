import { useCallback, useMemo, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { useBookmarkNotices, useUserKeywords, removeBookmark, type BookmarkNotice } from '../lib/bookmarks';
import { useFolders, createFolder, setBookmarkFolder } from '../lib/folders';
import { useReadSet } from '../lib/read';
import { useLastSeenAt } from '../lib/new-badge';
import { lightHaptic } from '../lib/haptics';
import { keywordMatches, firstMatchedKeyword } from '../lib/homeFeed';
import type { RootStackParamList } from '../lib/types';
import { COLORS, FONT, RADIUS, SPACING, WEIGHT } from '../lib/theme';
import { NoticeCard } from '../components/NoticeCard';
import { BookmarkIcon } from '../components/ui/BookmarkIcon';
import { FolderPickerSheet } from '../components/FolderPickerSheet';
import { AddBookmarksModal } from '../components/AddBookmarksModal';
import { SwipeToRemoveBookmark } from '../components/SwipeToRemoveBookmark';

type Props = NativeStackScreenProps<RootStackParamList, 'BookmarkFolder'>;

const FOLDER_META = {
  unread: { title: '읽지 않음', desc: '북마크 후 아직 확인 안 한 공지' },
  keyword: { title: '키워드 매치', desc: '내 키워드와 맞는 북마크 공지' },
} as const;

export default function BookmarkFolderScreen({ route }: Props) {
  const params = route.params;
  const folder = params.folder;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
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
    setRemovedIds((prev) => new Set(prev).add(id)); // optimistic
    removeBookmark(id).then(() => refresh());
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
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12} style={styles.back}>
          <Text style={styles.backText}>‹ 뒤로</Text>
        </TouchableOpacity>
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
        </ScrollView>
      ) : null}

      {loading ? (
        <View style={styles.center}><Text style={styles.sub}>불러오는 중…</Text></View>
      ) : list.length === 0 ? (
        <View style={styles.center}>
          <BookmarkIcon size={40} filled={false} color={COLORS.textTertiary} />
          <Text style={styles.emptyTitle}>{emptyText}</Text>
        </View>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(n) => n.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }: { item: BookmarkNotice }) => (
            <SwipeToRemoveBookmark onRemove={() => onRemoveBookmark(item.id)}>
              <NoticeCard
                notice={item}
                isRead={isRead(item.id)}
                isNew={!isRead(item.id) && !!lastSeenAt && (item.posted_at ?? '') > lastSeenAt}
                unread={!isRead(item.id)}
                keywordTag={folder === 'keyword' ? (firstMatchedKeyword(item, keywords) ?? undefined) : undefined}
                onPress={() => navigation.navigate('Detail', { notice: item })}
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
  },
  chipActive: { backgroundColor: COLORS.accent },
  chipText: { fontSize: FONT.caption, color: COLORS.textSecondary, fontWeight: WEIGHT.semibold },
  chipTextActive: { color: '#fff' },
  listContent: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xxl },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: SPACING.sm, paddingHorizontal: SPACING.xl },
  emptyTitle: { fontSize: FONT.subtitle, fontWeight: WEIGHT.semibold, color: COLORS.text },
  sub: { fontSize: FONT.caption, color: COLORS.textSecondary, textAlign: 'center' },
});
