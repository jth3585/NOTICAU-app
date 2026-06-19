import { useCallback, useState } from 'react';
import { Alert, FlatList, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useBookmarkNotices, useUserKeywords, removeBookmark, type BookmarkNotice } from '../lib/bookmarks';
import { useFolders, createFolder, renameFolder, deleteFolder, setBookmarkFolder, type Folder } from '../lib/folders';
import { useReadSet } from '../lib/read';
import { useLastSeenAt } from '../lib/new-badge';
import { lightHaptic } from '../lib/haptics';
import { keywordMatches } from '../lib/homeFeed';
import type { RootStackParamList } from '../lib/types';
import { COLORS, FONT, RADIUS, SHADOW, SPACING, TEXT, WEIGHT } from '../lib/theme';
import { NoticeCard } from '../components/NoticeCard';
import { BookmarkIcon } from '../components/ui/BookmarkIcon';
import { FolderNameModal } from '../components/FolderNameModal';
import { FolderPickerSheet } from '../components/FolderPickerSheet';
import { SwipeToRemoveBookmark } from '../components/SwipeToRemoveBookmark';
import { FolderIcon, HashIcon, MailIcon } from '../components/ui/icons';
import { NoticeListSkeleton } from '../components/ui/Skeleton';

export default function BookmarkScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { notices, loading, refresh } = useBookmarkNotices();
  const { folders, counts, refresh: refreshFolders } = useFolders();
  const { isRead, refresh: refreshRead } = useReadSet();
  const { lastSeenAt } = useLastSeenAt();
  const keywords = useUserKeywords();

  // 폴더 생성/이름변경 모달 상태
  const [modal, setModal] = useState<{ mode: 'create' } | { mode: 'rename'; folder: Folder } | null>(null);
  // 북마크 → 폴더 이동 선택 시트 대상
  const [pickerNotice, setPickerNotice] = useState<BookmarkNotice | null>(null);
  // 스와이프 삭제 optimistic 제거 id
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());

  const onRemoveBookmark = useCallback((id: string) => {
    lightHaptic();
    setRemovedIds((prev) => new Set(prev).add(id)); // optimistic: 목록에서 즉시 제거
    removeBookmark(id).then(() => { refresh(); refreshFolders(); });
  }, [refresh, refreshFolders]);

  useFocusEffect(useCallback(() => {
    refresh(); refreshRead(); refreshFolders();
  }, [refresh, refreshRead, refreshFolders]));

  const visibleNotices = notices.filter((n) => !removedIds.has(n.id));
  const unreadCount = notices.filter((n) => !isRead(n.id)).length;
  const keywordCount = keywords.length ? notices.filter((n) => keywordMatches(n, keywords)).length : 0;

  const submitModal = useCallback(async (name: string) => {
    const current = modal;
    if (!current) return;
    const res = current.mode === 'create'
      ? await createFolder(name)
      : await renameFolder(current.folder.id, name);
    if (!res.ok) {
      if (res.error === 'duplicate') Alert.alert('이미 있는 폴더 이름이에요', '다른 이름으로 만들어 주세요.');
      else Alert.alert('문제가 생겼어요', '잠시 후 다시 시도해 주세요.');
      return; // 모달 유지
    }
    setModal(null);
    refreshFolders();
  }, [modal, refreshFolders]);

  const onPickFolder = useCallback(async (folderId: string | null) => {
    const target = pickerNotice;
    setPickerNotice(null);
    if (!target) return;
    await setBookmarkFolder(target.id, folderId);
    refresh();
    refreshFolders();
  }, [pickerNotice, refresh, refreshFolders]);

  const onCreateFromPicker = useCallback(async (name: string) => {
    const res = await createFolder(name);
    if (res.ok) refreshFolders();
    return res.ok
      ? { ok: true as const, folderId: res.folder?.id }
      : { ok: false as const, error: res.error };
  }, [refreshFolders]);

  const onFolderLongPress = useCallback((folder: Folder) => {
    Alert.alert(folder.name, undefined, [
      { text: '이름 변경', onPress: () => setModal({ mode: 'rename', folder }) },
      {
        text: '삭제',
        style: 'destructive',
        onPress: () => Alert.alert(
          '폴더를 삭제할까요?',
          '폴더만 삭제되고 북마크는 그대로 남아요.',
          [
            { text: '취소', style: 'cancel' },
            { text: '삭제', style: 'destructive', onPress: async () => { await deleteFolder(folder.id); refreshFolders(); refresh(); } },
          ],
        ),
      },
      { text: '취소', style: 'cancel' },
    ]);
  }, [refreshFolders, refresh]);

  const Header = (
    <View>
      <View style={styles.collectionRow}>
        <Text style={styles.collectionTitle}>내 컬렉션</Text>
        <TouchableOpacity onPress={() => setModal({ mode: 'create' })} hitSlop={10} activeOpacity={0.7}>
          <Text style={styles.plus}>＋</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.folderRow}
      >
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
        {folders.map((f) => (
          <FolderCard
            key={f.id}
            Icon={FolderIcon}
            name={f.name}
            caption={`${counts.get(f.id) ?? 0}개`}
            onPress={() => navigation.navigate('BookmarkFolder', { folder: 'custom', folderId: f.id, folderName: f.name })}
            onLongPress={() => onFolderLongPress(f)}
          />
        ))}
        <TouchableOpacity style={styles.addCard} onPress={() => setModal({ mode: 'create' })} activeOpacity={0.7}>
          <Text style={styles.addPlus}>＋</Text>
          <Text style={styles.addText}>새 폴더</Text>
        </TouchableOpacity>
      </ScrollView>

      <Text style={styles.sectionTitle}>최근 추가 북마크</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <FlatList
        data={visibleNotices}
        keyExtractor={(n) => n.id}
        ListHeaderComponent={Header}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          loading ? (
            <NoticeListSkeleton count={5} />
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
          <SwipeToRemoveBookmark onRemove={() => onRemoveBookmark(item.id)}>
            <NoticeCard
              notice={item}
              isRead={isRead(item.id)}
              isNew={!isRead(item.id) && !!lastSeenAt && (item.posted_at ?? '') > lastSeenAt}
              unread={!isRead(item.id)}
              dimOnPress={false}
              onPress={() => navigation.navigate('Detail', { notice: item })}
              onLongPress={() => setPickerNotice(item)}
            />
          </SwipeToRemoveBookmark>
        )}
      />
      <FolderPickerSheet
        visible={pickerNotice !== null}
        folders={folders}
        currentFolderId={pickerNotice?.bookmark_folder_id ?? null}
        onPick={onPickFolder}
        onCreate={onCreateFromPicker}
        onClose={() => setPickerNotice(null)}
      />
      <FolderNameModal
        visible={modal !== null}
        title={modal?.mode === 'rename' ? '폴더 이름 변경' : '새 폴더'}
        initialValue={modal?.mode === 'rename' ? modal.folder.name : ''}
        submitLabel={modal?.mode === 'rename' ? '변경' : '생성'}
        onSubmit={submitModal}
        onClose={() => setModal(null)}
      />
    </SafeAreaView>
  );
}

function FolderCard({
  Icon, name, caption, onPress, onLongPress, disabled = false,
}: {
  Icon: (props: { size?: number; color: string }) => React.ReactElement;
  name: string; caption: string; onPress: () => void; onLongPress?: () => void; disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.folderCard, disabled && styles.folderCardDisabled]}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={300}
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
  collectionRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, marginBottom: SPACING.md,
  },
  collectionTitle: { ...TEXT.pageTitle },
  plus: { fontSize: 24, color: COLORS.text, fontWeight: WEIGHT.bold, lineHeight: 26 },
  folderRow: { flexDirection: 'row', gap: SPACING.md, paddingHorizontal: SPACING.lg },
  folderCard: {
    width: 130,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.card,
    padding: SPACING.lg,
    gap: SPACING.xs,
    ...SHADOW.card,
  },
  folderCardDisabled: { backgroundColor: COLORS.surface, opacity: 0.5 },
  addCard: {
    width: 88,
    backgroundColor: COLORS.bg,
    borderRadius: RADIUS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  addPlus: { fontSize: 22, color: COLORS.textTertiary, fontWeight: WEIGHT.bold },
  addText: { fontSize: FONT.caption, color: COLORS.textTertiary, fontWeight: WEIGHT.semibold },
  folderIcon: { marginBottom: SPACING.xs },
  emptyHint: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' },
  folderName: { fontSize: FONT.body, fontWeight: WEIGHT.semibold, color: COLORS.text },
  folderCaption: { fontSize: FONT.caption, color: COLORS.textSecondary },
  folderTextDim: { color: COLORS.textTertiary },
  sectionTitle: {
    ...TEXT.sectionLabel,
    paddingHorizontal: SPACING.lg, marginTop: SPACING.xl, marginBottom: SPACING.md,
  },
  list: { paddingBottom: SPACING.xxl },
  empty: { alignItems: 'center', gap: SPACING.sm, paddingHorizontal: SPACING.xl, paddingTop: SPACING.xxl },
  emptyTitle: { fontSize: FONT.subtitle, fontWeight: WEIGHT.semibold, color: COLORS.text },
  sub: { fontSize: FONT.caption, color: COLORS.textSecondary, textAlign: 'center' },
});
