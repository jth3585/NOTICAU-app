import { useEffect, useRef } from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Props = PressableProps & {
  scaleTo?: number;
  // press-in 후 스케일까지의 지연(ms). 스와이프로 감싼 카드에 주면, 미는 제스처가 먼저
  // 활성화되어 스케일이 발동 전에 취소됨 → 스케일과 스와이프가 겹치지 않는다.
  pressInDelay?: number;
  style?: StyleProp<ViewStyle>;
};

// 누르면 살짝 쑥 들어가는 스케일 피드백(토스 느낌). TouchableOpacity 대체.
export function PressableScale({ scaleTo = 0.97, pressInDelay = 0, style, children, onPressIn, onPressOut, ...rest }: Props) {
  const scale = useSharedValue(1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const down = () => { scale.value = withTiming(scaleTo, { duration: 90 }); };

  return (
    <AnimatedPressable
      style={[style, animStyle]}
      onPressIn={(e) => {
        if (pressInDelay > 0) timer.current = setTimeout(down, pressInDelay);
        else down();
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        if (timer.current) { clearTimeout(timer.current); timer.current = null; }
        scale.value = withTiming(1, { duration: 150 });
        onPressOut?.(e);
      }}
      {...rest}
    >
      {children}
    </AnimatedPressable>
  );
}
