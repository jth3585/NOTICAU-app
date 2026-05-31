import Svg, { Path } from 'react-native-svg';

// 4-pointed sparkle (사각별). lucide Sparkles와 동일한 실루엣.
export function SparkleIcon({ size = 14, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d="M12 0 L13.5 9 L22.5 12 L13.5 15 L12 24 L10.5 15 L1.5 12 L10.5 9 Z" />
    </Svg>
  );
}
