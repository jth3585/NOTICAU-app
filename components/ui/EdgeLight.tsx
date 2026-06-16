import { useEffect, useRef, useState } from 'react';
import { StyleSheet, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Rect } from 'react-native-svg';
import { COLORS, RADIUS } from '../../lib/theme';

const AnimatedRect = Animated.createAnimatedComponent(Rect);

type Props = { radius?: number; duration?: number; streaks?: number };

// 한 빛줄기를 이루는 레이어들. 모두 같은 시작 edge를 공유(같은 dashoffset)하므로
// 밝은 코어가 선두에 서고, 글로우가 그 주변을, 짧은 꼬리가 뒤로 옅게 깔린다.
//  - len: 줄기 1개 주기(period) 대비 길이 비율
//  - w: 선 두께(px), op: 불투명도, color: 색
const LAYERS = [
  { len: 0.07, w: 6,   op: 0.22, color: COLORS.accentGradient[0] }, // 글로우 (넓고 옅음)
  { len: 0.14, w: 2,   op: 0.20, color: COLORS.accent },            // 짧은 꼬리
  { len: 0.05, w: 2.4, op: 1.0,  color: COLORS.accent },            // 밝은 코어 (선두·맨 위)
] as const;

const MAX_W = 6; // 가장 두꺼운 레이어(글로우) — 가장자리 클리핑 방지용 inset 기준

// 부모(보통 AI 요약 박스) 위에 절대배치되어, 마운트(=화면 진입) 시 한 번만
// 밝은 빛줄기가 테두리를 한 바퀴 돌고 사라지는 엣지라이팅 효과.
// streaks=2 면 정반대(180°)에 두 줄기가 대칭으로 돈다.
// 동작 줄이기(Reduce Motion) 활성 기기에선 렌더하지 않음.
export function EdgeLight({ radius = RADIUS.box, duration = 1400, streaks = 2 }: Props) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const reduced = useReducedMotion();
  const offset = useSharedValue(0);
  const opacity = useSharedValue(1);
  const played = useRef(false); // 진입 시 1회만 재생

  const rw = Math.max(0, size.w - MAX_W);
  const rh = Math.max(0, size.h - MAX_W);
  // 라운드 사각 둘레 근사 (정확값 아니어도 시각적으로 충분)
  const perimeter = rw > 0 && rh > 0 ? 2 * (rw + rh) - 8 * radius + 2 * Math.PI * radius : 0;
  // dash 주기 = 둘레 / 줄기수 → 줄기들이 균등(2개면 정반대)하게 배치됨
  const period = streaks > 0 ? perimeter / streaks : perimeter;

  useEffect(() => {
    if (reduced || perimeter <= 0 || played.current) return;
    played.current = true;
    offset.value = 0;
    opacity.value = 1;
    offset.value = withTiming(-perimeter, { duration, easing: Easing.inOut(Easing.cubic) });
    opacity.value = withDelay(duration - 200, withTiming(0, { duration: 400 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perimeter, reduced]);

  const rectProps = useAnimatedProps(() => ({ strokeDashoffset: offset.value }));
  const containerStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  if (reduced) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, containerStyle]}
      onLayout={(e: LayoutChangeEvent) => {
        const { width, height } = e.nativeEvent.layout;
        if (width !== size.w || height !== size.h) setSize({ w: width, h: height });
      }}
    >
      {perimeter > 0 ? (
        <Svg width={size.w} height={size.h}>
          {LAYERS.map((l, i) => {
            const seg = period * l.len;
            return (
              <AnimatedRect
                key={i}
                x={MAX_W / 2}
                y={MAX_W / 2}
                width={rw}
                height={rh}
                rx={radius}
                ry={radius}
                fill="none"
                stroke={l.color}
                strokeWidth={l.w}
                strokeOpacity={l.op}
                strokeLinecap="round"
                strokeDasharray={`${seg} ${period - seg}`}
                animatedProps={rectProps}
              />
            );
          })}
        </Svg>
      ) : null}
    </Animated.View>
  );
}
