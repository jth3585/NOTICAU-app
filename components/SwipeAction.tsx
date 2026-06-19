import { useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { FONT, RADIUS, SPACING, WEIGHT } from '../lib/theme';

// 카드가 좌→우로 열리며 멈추는(걸리는) 거리. 이 폭이 곧 RNGH의 leftWidth.
const OPEN_W = 140;

type Props = {
  icon: React.ReactNode; // 흰색 아이콘
  label: string;
  color: string;         // 패널 배경색
  onTrigger: () => void; // 임계값 넘겨 손을 떼면 실행
  children: React.ReactNode;
};

// 북마크 추가/삭제 공용 스와이프. 좌→우로 임계값을 넘겨 손을 떼면 onTrigger 실행 후
// 곧바로 원위치로 스프링백.
//
// 액션 패널은 카드 본체(불투명 영역)와 동일한 inset의 클립 박스 안에서 꽉 채워진다.
//  - 클립이 카드 좌우 여백(marginHorizontal)과 같아서 → 닫힐 때 카드 오른쪽 여백
//    틈으로 패널이 비쳐 튀어나오지 않음.
//  - 클립 안을 패널이 가득 채워서 → 열 때 카드 왼쪽 가장자리까지 솔리드 컬러라
//    오른쪽 모서리 잔상이 보이지 않음.
export function SwipeAction({ icon, label, color, onTrigger, children }: Props) {
  const ref = useRef<SwipeableMethods>(null);
  const handled = useRef(false);

  const renderLeftActions = () => (
    <>
      {/* 카드 본체에 맞춘 클립 박스 (좌우 여백·반경 동일, overflow hidden) */}
      <View style={styles.clip}>
        <View style={[styles.panel, { backgroundColor: color }]}>
          {icon}
          <Text style={styles.label} numberOfLines={1}>{label}</Text>
        </View>
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
  clip: {
    position: 'absolute',
    left: SPACING.lg,   // 카드 marginHorizontal과 동일 → 오른쪽 여백으로 안 비침
    right: SPACING.lg,
    top: 0,
    bottom: SPACING.md, // 카드 marginBottom과 동일
    borderRadius: RADIUS.card,
    overflow: 'hidden',
  },
  panel: {
    ...StyleSheet.absoluteFillObject, // 클립을 가득 채움
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingLeft: SPACING.lg,
  },
  sizer: { width: OPEN_W },
  label: { color: '#fff', fontSize: FONT.caption, fontWeight: WEIGHT.bold },
});
