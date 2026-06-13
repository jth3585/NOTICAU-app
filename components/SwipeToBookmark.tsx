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
      <BookmarkIcon size={22} filled color="#fff" />
      <Text style={styles.actionText}>{alreadyBookmarked ? '이미 북마크됨' : '북마크'}</Text>
    </View>
  );

  return (
    <ReanimatedSwipeable
      ref={ref}
      friction={1.5}
      leftThreshold={60}
      dragOffsetFromLeftEdge={12}
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

const styles = StyleSheet.create({
  action: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    backgroundColor: COLORS.accent,
    borderRadius: RADIUS.card,
    // 카드와 동일한 좌우/하단 마진 (특히 marginRight 없으면 닫힐 때 우측 16px이 튀어나옴)
    marginLeft: SPACING.lg,
    marginRight: SPACING.lg,
    marginBottom: SPACING.md,
    paddingHorizontal: SPACING.lg,
  },
  actionMuted: { backgroundColor: COLORS.textTertiary },
  actionText: { color: '#fff', fontSize: FONT.caption, fontWeight: WEIGHT.bold },
});
