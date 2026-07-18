import {
  Dimensions, FlatList, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONT, RADIUS, SPACING, WEIGHT } from '../lib/theme';
import type { BookmarkNotice } from '../lib/bookmarks';
import { BottomSheet } from './ui/BottomSheet';

type Props = {
  visible: boolean;
  candidates: BookmarkNotice[];        // 이 폴더에 없는 북마크들
  folderNameOf: (id: string | null) => string | null; // 현재 소속 폴더명 표시용
  onAdd: (noticeId: string) => void;
  onClose: () => void;
};

// 커스텀 폴더에 기존 북마크를 담는 모달 (c안). 탭하면 즉시 이 폴더로 이동.
export function AddBookmarksModal({ visible, candidates, folderNameOf, onAdd, onClose }: Props) {
  // 내비바 뒤까지 내려가는 시트라 하단 여백에 insets.bottom 반영
  const insets = useSafeAreaInsets();
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={[styles.sheet, { paddingBottom: SPACING.xxl + insets.bottom }]}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>북마크 담기</Text>
          <TouchableOpacity onPress={onClose} hitSlop={10}><Text style={styles.done}>완료</Text></TouchableOpacity>
        </View>
        {candidates.length === 0 ? (
          <Text style={styles.empty}>담을 수 있는 북마크가 없어요</Text>
        ) : (
          <FlatList
            data={candidates}
            keyExtractor={(n) => n.id}
            style={styles.list}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => {
              const current = folderNameOf(item.bookmark_folder_id);
              return (
                <TouchableOpacity style={styles.row} onPress={() => onAdd(item.id)} activeOpacity={0.7}>
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{item.title}</Text>
                    {current ? <Text style={styles.rowSub}>현재: {current}</Text> : null}
                  </View>
                  <Text style={styles.add}>＋ 담기</Text>
                </TouchableOpacity>
              );
            }}
          />
        )}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: RADIUS.modal, borderTopRightRadius: RADIUS.modal,
    padding: SPACING.lg,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACING.sm },
  title: { fontSize: FONT.subtitle, fontWeight: WEIGHT.bold, color: COLORS.text },
  done: { fontSize: FONT.body, fontWeight: WEIGHT.semibold, color: COLORS.accentText },
  list: { maxHeight: Dimensions.get('window').height * 0.6 },
  empty: { fontSize: FONT.body, color: COLORS.textSecondary, textAlign: 'center', paddingVertical: SPACING.xl },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    paddingVertical: SPACING.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border,
  },
  rowText: { flex: 1 },
  rowTitle: { fontSize: FONT.body, color: COLORS.text, fontWeight: WEIGHT.semibold },
  rowSub: { fontSize: FONT.caption, color: COLORS.textTertiary, marginTop: 2 },
  add: { fontSize: FONT.caption, color: COLORS.accentText, fontWeight: WEIGHT.bold },
});
