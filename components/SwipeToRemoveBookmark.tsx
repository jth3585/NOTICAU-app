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
      <TrashIcon size={22} color="#fff" />
      <Text style={styles.actionText}>삭제</Text>
    </View>
  );

  return (
    <ReanimatedSwipeable
      ref={ref}
      friction={1.5}
      leftThreshold={ACTION_W * 0.6}
      overshootLeft={false}
      dragOffsetFromLeftEdge={12}
      // 복귀 스프링을 부드럽게 (기본 damping 1000 과감쇠 → 딱 붙는 느낌 제거)
      animationOptions={{ mass: 1, damping: 24, stiffness: 180, overshootClamping: false }}
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

const ACTION_W = 140; // 고정 폭 — 이 지점에서 걸려 멈추고(overshootLeft=false) 돌아옴. 추가 스와이프와 동일.

const styles = StyleSheet.create({
  action: {
    width: ACTION_W,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.danger,
    borderRadius: RADIUS.card,
    marginLeft: SPACING.lg,
    marginBottom: SPACING.md,
    paddingLeft: SPACING.lg,
  },
  actionText: { color: '#fff', fontSize: FONT.caption, fontWeight: WEIGHT.bold },
});
