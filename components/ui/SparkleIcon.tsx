import Svg, { Path } from 'react-native-svg';

// 4-pointed sparkle (사각별). lucide Sparkles와 동일한 실루엣.
export function SparkleIcon({ size = 14, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d="M12 1 Q12.9 11.1 23 12 Q12.9 12.9 12 23 Q11.1 12.9 1 12 Q11.1 11.1 12 1 Z" />
    </Svg>
  );
}
