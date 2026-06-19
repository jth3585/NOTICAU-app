import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
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
// EdgeLight는 부모(InfoBox) padding 안쪽(content box) 기준으로 절대배치되므로,
// 박스 "테두리"에 정확히 맞추려면 부모 padding(SPACING.lg)만큼 더 바깥으로 빼고 + 글로우 여유(GLOW_PAD).
const EDGE_INSET = SPACING.lg + GLOW_PAD;

// 블러 없는 글로우: 같은 경로를 굵기↑/투명도↓ 순으로 여러 겹 겹쳐 부드러운 빛처럼.
const LAYERS = [
  { w: 8, o: 0.12 },
  { w: 4.5, o: 0.22 },
  { w: 2.5, o: 0.55 },
  { w: 1.2, o: 1 },
];

// 부모(AI 요약 박스) 위에 절대배치. 마운트(=화면 진입) 시 한 번:
//   빛 두 줄기가 박스 테두리를 따라 한 바퀴 돌고 → 페이드아웃.
// 구현: 박스 테두리에 맞춘 라운드 사각 Path + strokeDasharray(두 줄기) + strokeDashoffset 회전.
//   글로우는 같은 Path를 굵기/투명도 다르게 겹쳐(LAYERS) 표현. (Skia·블러 필터 불필요)
// 동작 줄이기(Reduce Motion)면 렌더하지 않음.
export function EdgeLight({ radius = RADIUS.box, duration = 1500 }: Props) {
  const [size, setSize] = useState({ w: 0, h: 0 }); // 오버레이(박스+EDGE_INSET*2) 크기
  const reduced = useReducedMotion();
  const offset = useSharedValue(0);
  const opacity = useSharedValue(0);
  const played = useRef(false); // 진입 시 1회만 재생 (레이아웃 재측정으로 인한 재생 방지)

  // 박스(테두리) 실제 크기 = 오버레이 - GLOW_PAD*2. 경로를 박스 모서리 라인에 맞춘다.
  const boxW = Math.max(0, size.w - GLOW_PAD * 2);
  const boxH = Math.max(0, size.h - GLOW_PAD * 2);
  const r = Math.min(radius, boxW / 2, boxH / 2);
  // 라운드 사각 둘레 (정확값).
  const perimeter = boxW > 0 && boxH > 0 ? 2 * (boxW - 2 * r) + 2 * (boxH - 2 * r) + 2 * Math.PI * r : 0;

  // 라운드 사각 Path (좌상단 GLOW_PAD,GLOW_PAD 에서 시작).
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

  // 두 줄기: 주기를 둘레/2로 두면 두 줄기가 정반대(180°)에 균등 배치된다.
  const period = perimeter / 2;
  const seg = period * 0.3;                 // 각 줄기 길이 (주기의 30%)
  const dashArray = perimeter > 0 ? `${seg} ${period - seg}` : '0 1';

  useEffect(() => {
    if (reduced || perimeter <= 0 || played.current) return;
    played.current = true;
    offset.value = withTiming(-perimeter, { duration, easing: Easing.inOut(Easing.cubic) });
    opacity.value = withSequence(
      withTiming(1, { duration: 220 }),
      withDelay(duration - 220, withTiming(0, { duration: 520 })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perimeter, reduced]);

  const animatedProps = useAnimatedProps(() => ({ strokeDashoffset: offset.value }));
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
          {LAYERS.map((l, i) => (
            <AnimatedPath
              key={i}
              d={d}
              fill="none"
              stroke="url(#edgeLight)"
              strokeWidth={l.w}
              strokeOpacity={l.o}
              strokeLinecap="round"
              strokeDasharray={dashArray}
              animatedProps={animatedProps}
            />
          ))}
        </Svg>
      ) : null}
    </Animated.View>
  );
}
