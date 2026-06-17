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

// 테두리를 도는 빛의 그라데이션 — AI 요약 라벨과 동일한 파랑→보라 (#5B9BF0 → #9B7BF0).
// sweep이 매끄럽게 닫히도록 끝을 시작색으로 복귀.
const GRADIENT = ['#5B9BF0', '#9B7BF0', '#5B9BF0'];

// 캔버스를 박스보다 이만큼 키워 바깥쪽 블룸이 잘리지 않게 (음수 inset).
const PAD = 16;

// 부모(AI 요약 박스) 위에 절대배치. 마운트(=화면 진입) 시 한 번:
//   두 줄기 빛이 박스 테두리(모서리 라인)를 따라 돌고 → 페이드아웃.
// 구현: 박스 테두리에 딱 맞는 라운드 사각 Path + DashPathEffect(두 dash, phase 이동) + BlurMask 블룸.
// 동작 줄이기(Reduce Motion)면 렌더하지 않음.
export function EdgeLight({ radius = RADIUS.box, duration = 1600 }: Props) {
  const [size, setSize] = useState({ w: 0, h: 0 }); // 캔버스(박스+PAD*2) 크기
  const reduced = useReducedMotion();
  const progress = useSharedValue(0);
  const opacity = useSharedValue(0);
  const played = useRef(false);

  // 박스(테두리) 실제 크기 = 캔버스 - PAD*2. 경로를 박스 모서리 라인에 정확히 맞춘다.
  const boxW = Math.max(0, size.w - PAD * 2);
  const boxH = Math.max(0, size.h - PAD * 2);
  const perimeter = boxW > 0 && boxH > 0 ? 2 * (boxW + boxH) - 8 * radius + 2 * Math.PI * radius : 0;

  const path = useMemo(() => {
    const p = Skia.Path.Make();
    if (boxW > 0 && boxH > 0) p.addRRect(rrect(rect(PAD, PAD, boxW, boxH), radius, radius));
    return p;
  }, [boxW, boxH, radius]);

  useEffect(() => {
    if (reduced || perimeter <= 0 || played.current) return;
    played.current = true;
    progress.value = withTiming(1, { duration, easing: Easing.inOut(Easing.cubic) });
    opacity.value = withSequence(
      withTiming(1, { duration: 220 }),
      withDelay(duration - 220, withTiming(0, { duration: 520 })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perimeter, reduced]);

  // 두 막대(긴 줄기): 주기를 둘레/2로 두고 dash를 길게 → 두 막대가 테두리를 거의 다 채우고
  // 작은 틈 2개만 돌아다닌다. phase 이동으로 천천히 회전.
  const half = perimeter / 2;
  const seg = perimeter * 0.45;            // 각 막대 길이(틈은 약 5%씩)
  const intervals = perimeter > 0 ? [seg, Math.max(1, half - seg)] : [1, 1];
  const phase = useDerivedValue(() => -progress.value * perimeter);
  const groupOpacity = useDerivedValue(() => opacity.value);
  const center = vec(size.w / 2, size.h / 2);

  if (reduced) return null;

  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', top: -PAD, left: -PAD, right: -PAD, bottom: -PAD }}
      onLayout={(e: LayoutChangeEvent) => {
        const { width, height } = e.nativeEvent.layout;
        if (width !== size.w || height !== size.h) setSize({ w: width, h: height });
      }}
    >
      {boxW > 0 && boxH > 0 ? (
        <Canvas style={StyleSheet.absoluteFill}>
          <Group opacity={groupOpacity}>
            {/* 바깥 블룸: 넓고 부드러운 글로우 */}
            <Path path={path} style="stroke" strokeWidth={3} strokeCap="round" opacity={0.55}>
              <SweepGradient c={center} colors={GRADIENT} />
              <DashPathEffect intervals={intervals} phase={phase} />
              <BlurMask blur={10} style="solid" />
            </Path>
            {/* 코어: 얇은 선 + 부드럽게 (블러>두께 → 생 막대 아닌 부드러운 빛) */}
            <Path path={path} style="stroke" strokeWidth={1} strokeCap="round" opacity={0.9}>
              <SweepGradient c={center} colors={GRADIENT} />
              <DashPathEffect intervals={intervals} phase={phase} />
              <BlurMask blur={3} style="solid" />
            </Path>
          </Group>
        </Canvas>
      ) : null}
    </View>
  );
}
