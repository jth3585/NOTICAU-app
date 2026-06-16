import { useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { FONT, RADIUS, SPACING, WEIGHT } from '../lib/theme';

// 카드가 좌→우로 열리며 멈추는(걸리는) 거리. 이 폭이 곧 RNGH의 leftWidth.
const OPEN_W = 140;
// 패널은 OPEN_W보다 훨씬 길게 그려서 오른쪽 끝(둥근 모서리)이 카드 밑으로 숨는다.
// → 어느 지점까지 밀어도 카드와 패널 사이에 틈/모서리가 보이지 않음.
const PANEL_W = OPEN_W + 240;

type Props = {
  icon: React.ReactNode; // 흰색 아이콘
  label: string;
  color: string;         // 패널 배경색
  onTrigger: () => void; // 임계값 넘겨 손을 떼면 실행
  children: React.ReactNode;
};

// 북마크 추가/삭제 공용 스와이프. 좌→우로 임계값을 넘겨 손을 떼면 onTrigger 실행 후
// 곧바로 원위치로 스프링백. 액션 패널은 카드 밑까지 연장되어 항상 카드와 이어진 느낌.
export function SwipeAction({ icon, label, color, onTrigger, children }: Props) {
  const ref = useRef<SwipeableMethods>(null);
  const handled = useRef(false);

  const renderLeftActions = () => (
    <>
      {/* 실제 색 패널: 절대배치로 카드 밑까지 연장 (오른쪽 모서리 가려짐) */}
      <View style={[styles.panel, { backgroundColor: color }]}>
        {icon}
        <Text style={styles.label} numberOfLines={1}>{label}</Text>
      </View>
      {/* 측정용 스페이서: 이 폭이 곧 열리는 거리(leftWidth) */}
      <View style={styles.sizer} pointerEvents="none" />
    </>
  );

  return (
    <ReanimatedSwipeable
      ref={ref}
      friction={1.5}
      leftThreshold={OPEN_W * 0.55}
      overshootLeft={false}
      dragOffsetFromLeftEdge={12}
      // 복귀 스프링을 부드럽게 (기본 damping 1000 과감쇠 → 딱 붙는 느낌 제거)
      animationOptions={{ mass: 1, damping: 24, stiffness: 180, overshootClamping: false }}
      renderLeftActions={renderLeftActions}
      // 좌측 액션만 있으므로 open = 트리거. (RNGH는 우측 스와이프 open 시 direction을
      // 'right'로 넘기므로 방향 필터를 두지 않는다 — 이게 기존 버그의 원인이었음.)
      onSwipeableWillOpen={() => {
        if (handled.current) return;
        handled.current = true;
        onTrigger();
        // 손을 떼면 곧바로 원상태로 스프링백 (열린 채 머무르지 않음)
        requestAnimationFrame(() => ref.current?.close());
      }}
      onSwipeableClose={() => { handled.current = false; }}
    >
      {children}
    </ReanimatedSwipeable>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    left: SPACING.lg,
    top: 0,
    bottom: SPACING.md, // 카드 하단 여백과 맞춤
    width: PANEL_W,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingLeft: SPACING.lg,
    borderRadius: RADIUS.card,
  },
  sizer: { width: OPEN_W },
  label: { color: '#fff', fontSize: FONT.caption, fontWeight: WEIGHT.bold },
});
