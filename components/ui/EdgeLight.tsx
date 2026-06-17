import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import {
  Easing,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { BlurMask, Canvas, DashPathEffect, Group, Path, Skia, SweepGradient, rect, rrect, vec } from '@shopify/react-native-skia';
import { RADIUS } from '../../lib/theme';

type Props = { radius?: number; duration?: number };

// 테두리를 도는 빛의 그라데이션(브랜드 블루 계열, 살짝 인디고~시안 톤).
const GRADIENT = ['#6E8CEE', '#4A90E2', '#46C2E8', '#6E8CEE'];

// 부모(AI 요약 박스) 위에 절대배치. 마운트(=화면 진입) 시 한 번:
//   빛이 테두리를 따라 "삭" 그려지며 한 바퀴 차오르고 → 잠깐 머문 뒤 → 부드럽게 사라진다.
// 구현: 라운드 사각 Path + DashPathEffect(phase 애니메이션)로 stroke를 draw-on 트레이스.
//   색은 SweepGradient, 번짐은 BlurMask(글로우/블룸). 원형 스피너가 아니라 테두리 경로를 따라 흐름.
// 동작 줄이기(Reduce Motion)면 렌더하지 않음.
export function EdgeLight({ radius = RADIUS.box, duration = 1500 }: Props) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const reduced = useReducedMotion();
  const progress = useSharedValue(0); // 0→1: 테두리 그려짐
  const opacity = useSharedValue(0);
  const played = useRef(false);

  const INSET = 10; // 블룸이 캔버스 밖으로 잘리지 않도록 여유
  const w = Math.max(0, size.w - INSET * 2);
  const h = Math.max(0, size.h - INSET * 2);
  const perimeter = w > 0 && h > 0 ? 2 * (w + h) - 8 * radius + 2 * Math.PI * radius : 0;

  const path = useMemo(() => {
    const p = Skia.Path.Make();
    if (w > 0 && h > 0) p.addRRect(rrect(rect(INSET, INSET, w, h), radius, radius));
    return p;
  }, [w, h, radius]);

  useEffect(() => {
    if (reduced || perimeter <= 0 || played.current) return;
    played.current = true;
    // 그려지며 등장 → 끝나면 페이드아웃
    progress.value = withTiming(1, { duration, easing: Easing.inOut(Easing.cubic) });
    opacity.value = withSequence(
      withTiming(1, { duration: 250 }),                 // 빠르게 나타나
      withDelay(duration - 100, withTiming(0, { duration: 550 })), // 다 그려질 즈음 페이드
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perimeter, reduced]);

  // draw-on: dash 한 칸을 둘레만큼 두고 phase로 가려진 부분을 줄여 테두리를 따라 그려지게.
  const phase = useDerivedValue(() => perimeter * (1 - progress.value));
  const groupOpacity = useDerivedValue(() => opacity.value);
  const center = vec(size.w / 2, size.h / 2);

  if (reduced) return null;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={(e: LayoutChangeEvent) => {
      const { width, height } = e.nativeEvent.layout;
      if (width !== size.w || height !== size.h) setSize({ w: width, h: height });
    }}>
      {w > 0 && h > 0 ? (
        <Canvas style={styles.canvas}>
          <Group opacity={groupOpacity}>
            {/* 바깥 블룸: 넓은 선 + 강한 블러 */}
            <Path path={path} style="stroke" strokeWidth={6} strokeCap="round" opacity={0.45}>
              <SweepGradient c={center} colors={GRADIENT} />
              <DashPathEffect intervals={[perimeter, perimeter]} phase={phase} />
              <BlurMask blur={12} style="solid" />
            </Path>
            {/* 코어: 얇고 선명한 선 + 약한 블러 */}
            <Path path={path} style="stroke" strokeWidth={2.5} strokeCap="round">
              <SweepGradient c={center} colors={GRADIENT} />
              <DashPathEffect intervals={[perimeter, perimeter]} phase={phase} />
              <BlurMask blur={2} style="solid" />
            </Path>
          </Group>
        </Canvas>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ canvas: { flex: 1 } });
