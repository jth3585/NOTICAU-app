import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle, useSharedValue, useReducedMotion, withTiming, Easing, type SharedValue,
} from 'react-native-reanimated';

// 작은 입자들이 중심에서 톡 퍼졌다 사라지는 축하 버스트. (Lottie/에셋 없이 reanimated만)
// 마운트 시 1회 재생. 동작 줄이기면 렌더 안 함.
const COLORS_SET = ['#6E8CEE', '#9B7BF0', '#4A90E2', '#F5A623', '#10B981'];
const COUNT = 10;
const RADIUS = 42;

function Particle({ progress, angle, color }: { progress: SharedValue<number>; angle: number; color: string }) {
  const style = useAnimatedStyle(() => {
    const p = progress.value;
    const dist = RADIUS * p;
    return {
      transform: [
        { translateX: Math.cos(angle) * dist },
        { translateY: Math.sin(angle) * dist },
        { scale: 0.3 + p * 0.9 },
      ],
      opacity: 1 - p,
    };
  });
  return <Animated.View style={[styles.dot, { backgroundColor: color }, style]} />;
}

export function Celebration() {
  const reduced = useReducedMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    if (reduced) return;
    progress.value = withTiming(1, { duration: 720, easing: Easing.out(Easing.cubic) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (reduced) return null;

  return (
    <View pointerEvents="none" style={styles.wrap}>
      {Array.from({ length: COUNT }).map((_, i) => (
        <Particle
          key={i}
          progress={progress}
          angle={(i / COUNT) * Math.PI * 2}
          color={COLORS_SET[i % COLORS_SET.length]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', width: 7, height: 7, borderRadius: 3.5 },
});
