import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView, Modal, Platform, StyleSheet, Text,
  TextInput, TouchableOpacity, TouchableWithoutFeedback, View,
} from 'react-native';
import { COLORS, FONT, RADIUS, SPACING, WEIGHT } from '../lib/theme';
import { FOLDER_NAME_MAX } from '../lib/folders';

type Props = {
  visible: boolean;
  title: string;
  initialValue?: string;
  submitLabel: string;
  placeholder?: string;
  maxLength?: number;
  allowEmpty?: boolean; // true면 빈 값 제출 허용 (예: 호칭 비우기)
  onSubmit: (name: string) => void;
  onClose: () => void;
};

// 이름 입력 공용 모달 (폴더 생성/이름변경, 호칭 등). Alert.prompt는 iOS 전용이라 크로스플랫폼 모달로.
export function FolderNameModal({
  visible, title, initialValue = '', submitLabel,
  placeholder = '폴더 이름', maxLength = FOLDER_NAME_MAX, allowEmpty = false,
  onSubmit, onClose,
}: Props) {
  const [value, setValue] = useState(initialValue);

  // 열릴 때마다 초기값으로 리셋
  useEffect(() => {
    if (visible) setValue(initialValue);
  }, [visible, initialValue]);

  const trimmed = value.trim();
  const canSubmit = allowEmpty || trimmed.length > 0;

  return (
    // statusBar/navigationBarTranslucent: 안드로이드에서 백드롭이 상태바·내비바 영역까지 덮도록
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.overlay}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <TouchableWithoutFeedback>
              <View style={styles.card}>
                <Text style={styles.title}>{title}</Text>
                <TextInput
                  style={styles.input}
                  value={value}
                  onChangeText={setValue}
                  placeholder={placeholder}
                  placeholderTextColor={COLORS.textTertiary}
                  maxLength={maxLength}
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={() => { if (canSubmit) onSubmit(trimmed); }}
                />
                <View style={styles.actions}>
                  <TouchableOpacity style={styles.btn} onPress={onClose} activeOpacity={0.7}>
                    <Text style={styles.btnText}>취소</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.btn, styles.btnPrimary, !canSubmit && styles.btnDisabled]}
                    onPress={() => onSubmit(trimmed)}
                    disabled={!canSubmit}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.btnText, styles.btnPrimaryText]}>{submitLabel}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </KeyboardAvoidingView>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', paddingHorizontal: SPACING.xl },
  card: { backgroundColor: COLORS.surface, borderRadius: RADIUS.modal, padding: SPACING.lg, gap: SPACING.md },
  title: { fontSize: FONT.subtitle, fontWeight: WEIGHT.bold, color: COLORS.text },
  input: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.box,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
    fontSize: FONT.body, color: COLORS.text,
  },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: SPACING.sm },
  btn: { paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm, borderRadius: RADIUS.box },
  btnText: { fontSize: FONT.body, fontWeight: WEIGHT.semibold, color: COLORS.textSecondary },
  btnPrimary: { backgroundColor: COLORS.accent },
  btnPrimaryText: { color: '#fff' },
  btnDisabled: { opacity: 0.4 },
});
