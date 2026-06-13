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

const ACTION_W = 96;

// 카드를 좌→우(오른쪽)로 스와이프하면 좌측에 북마크 액션 영역이 드러나고,
// 임계값을 넘기면 북마크 추가(또는 이미 북마크면 피드백만) 후 원위치 복귀.
export function SwipeToBookmark({ alreadyBookmarked, onBookmark, onAlready, children }: Props) {
  const ref = useRef<SwipeableMethods>(null);
  const handled = useRef(false);

  const renderLeftActions = () => (
    <View style={[styles.action, alreadyBookmarked && styles.actionMuted]}>
      <BookmarkIcon size={20} filled color="#fff" />
      <Text style={styles.actionText} numberOfLines={1}>
        {alreadyBookmarked ? '이미 북마크됨' : '북마크'}
      </Text>
    </View>
  );

  return (
    <ReanimatedSwipeable
      ref={ref}
      friction={1}
      leftThreshold={ACTION_W * 0.55}
      overshootLeft={false}
      dragOffsetFromLeftEdge={12}
      renderLeftActions={renderLeftActions}
      onSwipeableWillOpen={(direction) => {
        if (direction !== 'left' || handled.current) return;
        handled.current = true;
        if (alreadyBookmarked) onAlready();
        else onBookmark();
        // 액션을 잠깐 보여준 뒤 부드럽게 원위치로
        setTimeout(() => ref.current?.close(), 220);
      }}
      onSwipeableClose={() => { handled.current = false; }}
    >
      {children}
    </ReanimatedSwipeable>
  );
}

const styles = StyleSheet.create({
  action: {
    width: ACTION_W,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    paddingLeft: SPACING.lg,
    backgroundColor: COLORS.accent,
    borderRadius: RADIUS.card,
    marginLeft: SPACING.lg,
    marginBottom: SPACING.md,
  },
  actionMuted: { backgroundColor: COLORS.textTertiary },
  actionText: { color: '#fff', fontSize: FONT.micro, fontWeight: WEIGHT.bold },
});
