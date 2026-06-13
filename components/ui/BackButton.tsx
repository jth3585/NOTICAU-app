import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { COLORS, FONT, SPACING, WEIGHT } from '../../lib/theme';
import { ChevronLeftIcon } from './icons';

// 서브화면 공용 뒤로가기 버튼 (모든 화면에서 동일하게).
export function BackButton({ onPress, disabled = false }: { onPress: () => void; disabled?: boolean }) {
  return (
    <TouchableOpacity onPress={onPress} hitSlop={8} disabled={disabled} style={styles.btn} activeOpacity={0.6}>
      <ChevronLeftIcon size={18} color={COLORS.textSecondary} />
      <Text style={styles.text}>뒤로</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start' },
  text: { fontSize: FONT.body, color: COLORS.textSecondary, fontWeight: WEIGHT.semibold },
});
