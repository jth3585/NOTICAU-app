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
import Svg, { Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import { COLORS, RADIUS } from '../../lib/theme';

const AnimatedRect = Animated.createAnimatedComponent(Rect);

type Props = { radius?: number; strokeWidth?: number; duration?: number; streaks?: number };

// 부모(보통 AI 요약 박스) 위에 절대배치되어, 마운트(=화면 진입) 시 한 번만
// 빛 줄기가 테두리를 한 바퀴 돌고 사라지는 엣지라이팅 효과.
// streaks=2 면 정반대(180°)에 두 줄기가 대칭으로 돈다.
// 동작 줄이기(Reduce Motion) 활성 기기에선 렌더하지 않음.
export function EdgeLight({ radius = RADIUS.box, strokeWidth = 2, duration = 1200, streaks = 2 }: Props) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const reduced = useReducedMotion();
  const offset = useSharedValue(0);
  const opacity = useSharedValue(1);
  const played = useRef(false); // 진입 시 1회만 재생 (레이아웃 재측정으로 인한 재생 방지)

  const sw = strokeWidth;
  const rw = Math.max(0, size.w - sw);
  const rh = Math.max(0, size.h - sw);
  // 라운드 사각 둘레 근사 (정확값 아니어도 시각적으로 충분)
  const perimeter = rw > 0 && rh > 0 ? 2 * (rw + rh) - 8 * radius + 2 * Math.PI * radius : 0;
  // dash 주기 = 둘레 / 줄기수 → 줄기들이 균등(2개면 정반대)하게 배치됨
  const period = streaks > 0 ? perimeter / streaks : perimeter;
  const seg = period * 0.32; // 각 줄기 길이 (주기의 ~32%)

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
          <Defs>
            <LinearGradient id="edgeLight" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={COLORS.accentGradient[0]} />
              <Stop offset="0.5" stopColor={COLORS.accentGradient[1]} />
              <Stop offset="1" stopColor={COLORS.accentGradient[2]} />
            </LinearGradient>
          </Defs>
          <AnimatedRect
            x={sw / 2}
            y={sw / 2}
            width={rw}
            height={rh}
            rx={radius}
            ry={radius}
            fill="none"
            stroke="url(#edgeLight)"
            strokeWidth={sw}
            strokeLinecap="round"
            strokeDasharray={`${seg} ${period - seg}`}
            animatedProps={rectProps}
          />
        </Svg>
      ) : null}
    </Animated.View>
  );
}
