import { useEffect, useMemo, useRef, useState } from 'react';
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
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { RADIUS, SPACING } from '../../lib/theme';

const AnimatedPath = Animated.createAnimatedComponent(Path);

type Props = { radius?: number; duration?: number };

// 빛 색: AI 요약 라벨과 동일한 파랑→보라. 양 끝을 같은 색으로 둬 그라데이션이 매끄럽게 이어짐.
const C1 = '#5B9BF0';
const C2 = '#9B7BF0';

// 글로우가 박스 밖으로 살짝 번질 여유.
const GLOW_PAD = 8;
// EdgeLight는 부모(InfoBox) padding 안쪽(content box) 기준 절대배치 → 박스 "테두리"에 맞추려면
// 부모 padding(SPACING.lg)만큼 더 바깥으로 빼고 + 글로우 여유(GLOW_PAD).
const EDGE_INSET = SPACING.lg + GLOW_PAD;

// 부모(AI 요약 박스) 위에 절대배치. 마운트(=화면 진입) 시 한 번:
//   빛 두 줄기가 박스 테두리를 따라 한 바퀴 돌고 → 끝에서 페이드아웃.
// 구현: 라운드 사각 Path + strokeDasharray(두 줄기) + strokeDashoffset 회전.
//   글로우는 굵고 흐린 path + 얇고 진한 path 두 겹(각자 animatedProps). Skia·블러 불필요.
// 동작 줄이기(Reduce Motion)면 렌더하지 않음.
export function EdgeLight({ radius = RADIUS.box, duration = 1500 }: Props) {
  const [size, setSize] = useState({ w: 0, h: 0 }); // 오버레이(박스+GLOW_PAD*2) 크기
  const reduced = useReducedMotion();
  const offset = useSharedValue(0);
  const opacity = useSharedValue(1); // 1에서 시작 → 첫 프레임부터 보이고, 끝에서만 페이드아웃
  const played = useRef(false);

  const boxW = Math.max(0, size.w - GLOW_PAD * 2);
  const boxH = Math.max(0, size.h - GLOW_PAD * 2);
  const r = Math.max(0, Math.min(radius, boxW / 2, boxH / 2));
  const perimeter = boxW > 0 && boxH > 0 ? 2 * (boxW - 2 * r) + 2 * (boxH - 2 * r) + 2 * Math.PI * r : 0;

  const d = useMemo(() => {
    if (boxW <= 0 || boxH <= 0) return '';
    const x = GLOW_PAD, y = GLOW_PAD, w = boxW, h = boxH;
    return [
      `M ${x + r} ${y}`,
      `H ${x + w - r}`,
      `A ${r} ${r} 0 0 1 ${x + w} ${y + r}`,
      `V ${y + h - r}`,
      `A ${r} ${r} 0 0 1 ${x + w - r} ${y + h}`,
      `H ${x + r}`,
      `A ${r} ${r} 0 0 1 ${x} ${y + h - r}`,
      `V ${y + r}`,
      `A ${r} ${r} 0 0 1 ${x + r} ${y}`,
      'Z',
    ].join(' ');
  }, [boxW, boxH, r]);

  // 두 줄기: 주기를 둘레/2로 두면 두 줄기가 정반대(180°)에 균등 배치.
  const period = perimeter / 2;
  const seg = period * 0.3;
  const dashArray = perimeter > 0 ? `${seg} ${period - seg}` : undefined;

  useEffect(() => {
    if (reduced || perimeter <= 0 || played.current) return;
    played.current = true;
    offset.value = withTiming(-perimeter, { duration, easing: Easing.inOut(Easing.cubic) });
    opacity.value = withDelay(duration - 350, withTiming(0, { duration: 550 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perimeter, reduced]);

  // 레이어별 자체 animatedProps (공유하면 reanimated 바인딩이 깨질 수 있음).
  const glowProps = useAnimatedProps(() => ({ strokeDashoffset: offset.value }));
  const coreProps = useAnimatedProps(() => ({ strokeDashoffset: offset.value }));
  const containerStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  if (reduced) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        { position: 'absolute', top: -EDGE_INSET, left: -EDGE_INSET, right: -EDGE_INSET, bottom: -EDGE_INSET },
        containerStyle,
      ]}
      onLayout={(e: LayoutChangeEvent) => {
        const { width, height } = e.nativeEvent.layout;
        if (width !== size.w || height !== size.h) setSize({ w: width, h: height });
      }}
    >
      {d ? (
        <Svg width={size.w} height={size.h} style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id="edgeLight" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={C1} />
              <Stop offset="0.5" stopColor={C2} />
              <Stop offset="1" stopColor={C1} />
            </LinearGradient>
          </Defs>
          {/* 글로우: 굵고 흐리게 */}
          <AnimatedPath
            d={d}
            fill="none"
            stroke="url(#edgeLight)"
            strokeWidth={6}
            strokeOpacity={0.18}
            strokeLinecap="round"
            strokeDasharray={dashArray}
            animatedProps={glowProps}
          />
          {/* 코어: 얇고 진하게 */}
          <AnimatedPath
            d={d}
            fill="none"
            stroke="url(#edgeLight)"
            strokeWidth={2}
            strokeOpacity={0.95}
            strokeLinecap="round"
            strokeDasharray={dashArray}
            animatedProps={coreProps}
          />
        </Svg>
      ) : null}
    </Animated.View>
  );
}
