import { useCallback, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useScrollToTop } from '@react-navigation/native';
import { useTabReselect } from '../lib/useTabReselect';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useBookmarkNotices, useUserKeywords, removeBookmark, type BookmarkNotice } from '../lib/bookmarks';
import { useFolders, createFolder, renameFolder, deleteFolder, setBookmarkFolder, type Folder } from '../lib/folders';
import { useReadSet } from '../lib/read';
import { useLastSeenAt } from '../lib/new-badge';
import { lightHaptic } from '../lib/haptics';
import { toast } from '../lib/toast';
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
import { EmptyState } from '../components/ui/EmptyState';

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
    toast('북마크에서 삭제했어요');
    // 스와이프 스프링백이 보인 뒤 제거 (북마크 추가와 동일한 감 — 즉시 제거하면 딱 달라붙음)
    setTimeout(() => {
      setRemovedIds((prev) => new Set(prev).add(id));
      removeBookmark(id).then(() => { refresh(); refreshFolders(); });
    }, 300);
  }, [refresh, refreshFolders]);

  useFocusEffect(useCallback(() => {
    refresh(); refreshRead(); refreshFolders();
  }, [refresh, refreshRead, refreshFolders]));

  // 북마크 탭 재탭 → 맨 위로 스크롤 + 새로고침
  const listRef = useRef<FlashListRef<BookmarkNotice>>(null);
  useScrollToTop(listRef as any);
  useTabReselect(useCallback(() => { refresh(); refreshFolders(); }, [refresh, refreshFolders]));

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
      <FlashList
        ref={listRef}
        data={visibleNotices}
        keyExtractor={(n) => n.id}
        ListHeaderComponent={Header}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          loading ? (
            <NoticeListSkeleton count={5} />
          ) : (
            <EmptyState
              icon={<BookmarkIcon size={30} filled={false} color={COLORS.accent} />}
              title="아직 북마크한 공지가 없어요"
              subtitle="공지를 옆으로 밀거나 북마크 아이콘을 눌러보세요"
            />
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
              onPress={() => navigation.navigate('Detail', { notice: item, source: 'bookmark' })}
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
        submitLabel={modal?.mode === 'rename' ? '저장' : '만들기'}
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
    paddingHorizontal: SPACING.lg, paddingTop: SPACING.lg, marginBottom: SPACING.md,
  },
  // 중간 위계 섹션 헤딩(최근 추가 북마크의 작은 라벨보다 한 단계 위). 큰 페이지 제목은 아님.
  collectionTitle: { fontSize: FONT.subtitle, fontWeight: WEIGHT.bold, color: COLORS.text },
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
