import { StyleSheet, TouchableOpacity } from 'react-native';
import { COLORS } from '../../lib/theme';
import { ChevronLeftIcon } from './icons';

// 서브화면 공용 뒤로가기 버튼 (셰브론만). 헤더가 alignItems:center라 제목과 수직 정렬됨.
export function BackButton({ onPress, disabled = false }: { onPress: () => void; disabled?: boolean }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      hitSlop={12}
      disabled={disabled}
      style={styles.btn}
      activeOpacity={0.6}
      accessibilityRole="button"
      accessibilityLabel="뒤로 가기"
    >
      <ChevronLeftIcon size={26} color={COLORS.text} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: { alignSelf: 'flex-start', justifyContent: 'center' },
});
