import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import {
  Easing,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { BlurMask, Canvas, DashPathEffect, Group, Path, Skia, rect, rrect } from '@shopify/react-native-skia';
import { RADIUS } from '../../lib/theme';

type Props = { radius?: number; duration?: number };

// 옅은 파스텔 박스 위에서 도드라지는 accent 블루.
const ACCENT = '#4A90E2';
const ACCENT_GLOW = '#6E8CEE';

// 부모(AI 요약 박스) 위에 절대배치되어, 마운트(=화면 진입) 시 한 번 빛줄기가 "테두리를 따라"
// 한 바퀴 돌고 사라지는 엣지라이팅.
//  - 라운드 사각 Path를 만들고 DashPathEffect의 phase를 애니메이션해 dash가 경로(모서리 포함)를
//    따라 흐르게 한다(원형 스피너가 아니라 진짜 테두리 따라 흐름).
//  - 짧은 dash 2개를 작은 간격으로 붙여 "거의 연결된 두 줄기"로 보이게.
//  - BlurMask로 실제 글로우. 동작 줄이기(Reduce Motion)면 렌더 안 함.
export function EdgeLight({ radius = RADIUS.box, duration = 1700 }: Props) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const reduced = useReducedMotion();
  const progress = useSharedValue(0);
  const opacity = useSharedValue(1);
  const played = useRef(false);

  const INSET = 7; // 글로우가 캔버스 밖으로 잘리지 않도록
  const w = Math.max(0, size.w - INSET * 2);
  const h = Math.max(0, size.h - INSET * 2);
  // 라운드 사각 둘레 근사 (dash 간격 계산용)
  const perimeter = w > 0 && h > 0 ? 2 * (w + h) - 8 * radius + 2 * Math.PI * radius : 0;

  const path = useMemo(() => {
    const p = Skia.Path.Make();
    if (w > 0 && h > 0) p.addRRect(rrect(rect(INSET, INSET, w, h), radius, radius));
    return p;
  }, [w, h, radius]);

  useEffect(() => {
    if (reduced || perimeter <= 0 || played.current) return;
    played.current = true;
    progress.value = withTiming(1, { duration, easing: Easing.inOut(Easing.cubic) });
    opacity.value = withDelay(duration - 300, withTiming(0, { duration: 500 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perimeter, reduced]);

  // 두 줄기를 거의 붙게: 짧은 dash 2개 + 아주 작은 간격, 나머지는 큰 공백 (한 바퀴에 1쌍).
  const seg = perimeter * 0.06;
  const gapClose = perimeter * 0.015;
  const intervals = perimeter > 0
    ? [seg, gapClose, seg, Math.max(1, perimeter - 2 * seg - gapClose)]
    : [1, 1];

  // phase를 둘레만큼 이동시켜 dash가 경로를 한 바퀴 흐르게.
  const phase = useDerivedValue(() => -progress.value * perimeter);
  const groupOpacity = useDerivedValue(() => opacity.value);

  if (reduced) return null;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={(e: LayoutChangeEvent) => {
      const { width, height } = e.nativeEvent.layout;
      if (width !== size.w || height !== size.h) setSize({ w: width, h: height });
    }}>
      {w > 0 && h > 0 ? (
        <Canvas style={styles.canvas}>
          <Group opacity={groupOpacity}>
            {/* 글로우: 넓은 선 + 강한 블러 */}
            <Path path={path} style="stroke" strokeWidth={5} strokeCap="round" color={ACCENT_GLOW} opacity={0.5}>
              <DashPathEffect intervals={intervals} phase={phase} />
              <BlurMask blur={9} style="solid" />
            </Path>
            {/* 코어: 얇고 선명한 선 + 약한 블러 */}
            <Path path={path} style="stroke" strokeWidth={2} strokeCap="round" color={ACCENT}>
              <DashPathEffect intervals={intervals} phase={phase} />
              <BlurMask blur={2} style="solid" />
            </Path>
          </Group>
        </Canvas>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ canvas: { flex: 1 } });
