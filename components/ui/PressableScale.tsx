import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Props = PressableProps & { scaleTo?: number; style?: StyleProp<ViewStyle> };

// 누르면 살짝 쑥 들어가는 스케일 피드백(토스 느낌). TouchableOpacity 대체.
export function PressableScale({ scaleTo = 0.97, style, children, onPressIn, onPressOut, ...rest }: Props) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <AnimatedPressable
      style={[style, animStyle]}
      onPressIn={(e) => { scale.value = withTiming(scaleTo, { duration: 90 }); onPressIn?.(e); }}
      onPressOut={(e) => { scale.value = withTiming(1, { duration: 150 }); onPressOut?.(e); }}
      {...rest}
    >
      {children}
    </AnimatedPressable>
  );
}
