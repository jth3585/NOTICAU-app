import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import {
  Easing,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { BlurMask, Canvas, Group, RoundedRect, SweepGradient, vec } from '@shopify/react-native-skia';
import { RADIUS } from '../../lib/theme';

type Props = { radius?: number; duration?: number; streaks?: number };

// accent(#4A90E2) RGB. 옅은 파스텔 박스 위에서 도드라지도록 accent 사용.
const ACCENT_RGB = '74,144,226';

// Sweep(원뿔) 그라데이션의 색 정지점 생성. 각 줄기 중심에 짧은 밝은 호(arc)를 두고
// 나머지는 투명 → 회전시키면 밝은 빛점이 테두리를 따라 돈다. BlurMask로 글로우.
function buildStops(streaks: number, peakAlpha: number) {
  const colors: string[] = [];
  const positions: number[] = [];
  const half = 0.035; // 밝은 호의 반폭(원 둘레 대비)
  const T = `rgba(${ACCENT_RGB},0)`;
  const B = `rgba(${ACCENT_RGB},${peakAlpha})`;
  const push = (pos: number, c: string) => { positions.push(pos); colors.push(c); };
  push(0, T);
  for (let i = 0; i < streaks; i++) {
    const c = (i + 0.5) / streaks; // 각 구간 중앙에 피크
    push(Math.max(0.0001, c - half), T);
    push(c, B);
    push(Math.min(0.9999, c + half), T);
  }
  push(1, T);
  return { colors, positions };
}

// 부모(AI 요약 박스) 위에 절대배치되어, 마운트(=화면 진입) 시 한 번 빛줄기가 테두리를
// 한 바퀴 돌고 사라지는 엣지라이팅. Skia로 실제 블러 글로우 + 회전 sweep 그라데이션.
// 동작 줄이기(Reduce Motion) 활성 기기에선 렌더하지 않음.
export function EdgeLight({ radius = RADIUS.box, duration = 1700, streaks = 2 }: Props) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const reduced = useReducedMotion();
  const progress = useSharedValue(0);
  const opacity = useSharedValue(1);
  const played = useRef(false);

  useEffect(() => {
    if (reduced || size.w === 0 || played.current) return;
    played.current = true;
    progress.value = withTiming(1, { duration, easing: Easing.inOut(Easing.cubic) });
    opacity.value = withDelay(duration - 300, withTiming(0, { duration: 500 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, reduced]);

  const cx = size.w / 2;
  const cy = size.h / 2;
  const center = vec(cx, cy);
  // 한 바퀴(2π) 회전
  const transform = useDerivedValue(() => [{ rotate: progress.value * 2 * Math.PI }]);
  const groupOpacity = useDerivedValue(() => opacity.value);

  const glow = buildStops(streaks, 0.6);
  const core = buildStops(streaks, 1);

  // BlurMask 글로우가 캔버스 밖으로 잘리지 않도록 살짝 안쪽으로.
  const INSET = 7;
  const x = INSET, y = INSET;
  const w = Math.max(0, size.w - INSET * 2);
  const h = Math.max(0, size.h - INSET * 2);

  if (reduced) return null;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={(e: LayoutChangeEvent) => {
      const { width, height } = e.nativeEvent.layout;
      if (width !== size.w || height !== size.h) setSize({ w: width, h: height });
    }}>
      {size.w > 0 && w > 0 && h > 0 ? (
        <Canvas style={styles.canvas}>
          <Group transform={transform} origin={center} opacity={groupOpacity}>
            {/* 글로우: 넓은 선 + 강한 블러 */}
            <RoundedRect x={x} y={y} width={w} height={h} r={radius} style="stroke" strokeWidth={5}>
              <SweepGradient c={center} colors={glow.colors} positions={glow.positions} />
              <BlurMask blur={10} style="solid" />
            </RoundedRect>
            {/* 코어: 얇고 선명한 밝은 선 + 약한 블러 */}
            <RoundedRect x={x} y={y} width={w} height={h} r={radius} style="stroke" strokeWidth={2}>
              <SweepGradient c={center} colors={core.colors} positions={core.positions} />
              <BlurMask blur={2} style="solid" />
            </RoundedRect>
          </Group>
        </Canvas>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ canvas: { flex: 1 } });
