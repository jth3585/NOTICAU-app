import { useEffect, useState } from 'react';
import {
  Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONT, RADIUS, SPACING, WEIGHT } from '../lib/theme';
import { FOLDER_NAME_MAX, type Folder } from '../lib/folders';
import { BottomSheet } from './ui/BottomSheet';
import { CheckIcon, FolderIcon } from './ui/icons';

type Props = {
  visible: boolean;
  folders: Folder[];
  currentFolderId: string | null;
  onPick: (folderId: string | null) => void;
  onCreate: (name: string) => Promise<{ ok: boolean; folderId?: string; error?: 'duplicate' | 'empty' | 'unknown' }>;
  onClose: () => void;
};

// 북마크를 폴더로 이동할 때 쓰는 선택 시트. 미분류 / 기존 폴더 / 새 폴더 만들기.
export function FolderPickerSheet({ visible, folders, currentFolderId, onPick, onCreate, onClose }: Props) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  // 내비바 뒤까지 내려가는 시트라 하단 여백에 insets.bottom 반영
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!visible) { setCreating(false); setName(''); }
  }, [visible]);

  const submitCreate = async () => {
    const clean = name.trim();
    if (!clean) return;
    const res = await onCreate(clean);
    if (!res.ok) {
      Alert.alert(res.error === 'duplicate' ? '이미 있는 폴더 이름이에요' : '문제가 생겼어요',
        res.error === 'duplicate' ? '다른 이름으로 만들어 주세요.' : '잠시 후 다시 시도해 주세요.');
      return;
    }
    setCreating(false);
    setName('');
    if (res.folderId) onPick(res.folderId); // 새 폴더로 바로 이동
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} avoidKeyboard>
      <View style={[styles.sheet, { paddingBottom: SPACING.xxl + insets.bottom }]}>
        <Text style={styles.title}>폴더로 이동</Text>
        <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
          <Row
            label="미분류"
            active={currentFolderId === null}
            onPress={() => onPick(null)}
          />
          {folders.map((f) => (
            <Row
              key={f.id}
              label={f.name}
              icon
              active={currentFolderId === f.id}
              onPress={() => onPick(f.id)}
            />
          ))}
        </ScrollView>

        {creating ? (
          <View style={styles.createRow}>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="새 폴더 이름"
              placeholderTextColor={COLORS.textTertiary}
              maxLength={FOLDER_NAME_MAX}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={submitCreate}
            />
            <TouchableOpacity style={styles.createBtn} onPress={submitCreate} activeOpacity={0.7}>
              <Text style={styles.createBtnText}>만들기</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={styles.newFolder} onPress={() => setCreating(true)} activeOpacity={0.7}>
            <Text style={styles.newFolderText}>＋ 새 폴더 만들기</Text>
          </TouchableOpacity>
        )}
      </View>
    </BottomSheet>
  );
}

function Row({ label, active, onPress, icon = false }: { label: string; active: boolean; onPress: () => void; icon?: boolean }) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      {icon ? <FolderIcon size={18} color={COLORS.textSecondary} /> : <View style={styles.iconSpace} />}
      <Text style={[styles.rowLabel, active && styles.rowLabelActive]} numberOfLines={1}>{label}</Text>
      {active ? <CheckIcon size={18} color={COLORS.accent} /> : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: RADIUS.modal, borderTopRightRadius: RADIUS.modal,
    padding: SPACING.lg, gap: SPACING.sm,
  },
  title: { fontSize: FONT.subtitle, fontWeight: WEIGHT.bold, color: COLORS.text, marginBottom: SPACING.xs },
  list: { maxHeight: 320 },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: SPACING.md },
  iconSpace: { width: 18 },
  rowLabel: { flex: 1, fontSize: FONT.body, color: COLORS.text },
  rowLabelActive: { color: COLORS.accentText, fontWeight: WEIGHT.semibold },
  newFolder: { paddingVertical: SPACING.md, marginTop: SPACING.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border },
  newFolderText: { fontSize: FONT.body, color: COLORS.accentText, fontWeight: WEIGHT.semibold },
  createRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginTop: SPACING.xs },
  input: {
    flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.box,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, fontSize: FONT.body, color: COLORS.text,
  },
  createBtn: { backgroundColor: COLORS.accent, borderRadius: RADIUS.box, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm },
  createBtnText: { color: '#fff', fontSize: FONT.body, fontWeight: WEIGHT.semibold },
});
