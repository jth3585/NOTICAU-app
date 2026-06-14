import { useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { COLORS, FONT, RADIUS, SPACING, WEIGHT } from '../lib/theme';
import { BookmarkIcon } from './ui/BookmarkIcon';

type Props = {
  alreadyBookmarked: boolean;
  onBookmark: () => void;  // 미북마크 상태에서 임계값 넘김 → 추가
  onAlready: () => void;   // 이미 북마크된 상태에서 스와이프 → 피드백만
  children: React.ReactNode;
};

// 카드를 좌→우(오른쪽)로 스와이프하면 좌측에 북마크 액션 영역이 드러나고,
// 임계값을 넘겨 손을 떼면 즉시 원상태로 복귀하면서 북마크 추가(또는 이미 북마크면 피드백만).
export function SwipeToBookmark({ alreadyBookmarked, onBookmark, onAlready, children }: Props) {
  const ref = useRef<SwipeableMethods>(null);
  const handled = useRef(false);

  const renderLeftActions = () => (
    <View style={[styles.action, alreadyBookmarked && styles.actionMuted]}>
      <BookmarkIcon size={20} filled color="#fff" />
      <Text style={styles.actionText} numberOfLines={1}>{alreadyBookmarked ? '북마크됨' : '북마크'}</Text>
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
      // 좌측 액션만 있으므로 open = 북마크 액션. (RNGH는 우측 스와이프 open 시
      // direction을 'right'로 넘기므로 방향 필터를 두지 않는다 — 이게 기존 버그의 원인이었음.)
      onSwipeableWillOpen={() => {
        if (handled.current) return;
        handled.current = true;
        if (alreadyBookmarked) onAlready();
        else onBookmark();
        // 손을 떼면 곧바로 원상태로 스프링백 (한 프레임 뒤 close — 열린 채 머무르지 않음)
        requestAnimationFrame(() => ref.current?.close());
      }}
      onSwipeableClose={() => { handled.current = false; }}
    >
      {children}
    </ReanimatedSwipeable>
  );
}

const ACTION_W = 96; // 고정 폭 — 스와이프가 이 지점에서 걸려 멈추고(overshootLeft=false) 돌아옴

const styles = StyleSheet.create({
  action: {
    width: ACTION_W,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    backgroundColor: COLORS.accent,
    borderRadius: RADIUS.card,
    marginLeft: SPACING.lg,
    marginBottom: SPACING.md,
    paddingLeft: SPACING.lg,
  },
  actionMuted: { backgroundColor: COLORS.textTertiary },
  actionText: { color: '#fff', fontSize: FONT.micro, fontWeight: WEIGHT.bold },
});
