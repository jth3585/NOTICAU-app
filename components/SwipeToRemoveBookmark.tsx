import { useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { COLORS, FONT, RADIUS, SPACING, WEIGHT } from '../lib/theme';
import { TrashIcon } from './ui/icons';

type Props = {
  onRemove: () => void; // 임계값 넘김 → 북마크 삭제
  children: React.ReactNode;
};

// 전체공지의 SwipeToBookmark와 동일한 제스처. 좌→우 스와이프 후 손을 떼면
// 북마크 삭제 + 원위치 복귀. (삭제는 화면에서 optimistic하게 목록 제거)
export function SwipeToRemoveBookmark({ onRemove, children }: Props) {
  const ref = useRef<SwipeableMethods>(null);
  const handled = useRef(false);

  const renderLeftActions = () => (
    <View style={styles.action}>
      <TrashIcon size={20} color="#fff" />
      <Text style={styles.actionText}>삭제</Text>
    </View>
  );

  return (
    <ReanimatedSwipeable
      ref={ref}
      friction={1.5}
      leftThreshold={60}
      dragOffsetFromLeftEdge={12}
      renderLeftActions={renderLeftActions}
      onSwipeableWillOpen={() => {
        if (handled.current) return;
        handled.current = true;
        onRemove();
        requestAnimationFrame(() => ref.current?.close());
      }}
      onSwipeableClose={() => { handled.current = false; }}
    >
      {children}
    </ReanimatedSwipeable>
  );
}

const styles = StyleSheet.create({
  action: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    backgroundColor: COLORS.danger,
    borderRadius: RADIUS.card,
    // 카드와 동일 마진 (marginRight 없으면 닫힐 때 우측이 튀어나옴)
    marginLeft: SPACING.lg,
    marginRight: SPACING.lg,
    marginBottom: SPACING.md,
    paddingHorizontal: SPACING.lg,
  },
  actionText: { color: '#fff', fontSize: FONT.caption, fontWeight: WEIGHT.bold },
});
