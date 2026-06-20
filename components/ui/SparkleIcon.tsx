import Svg, { Path } from 'react-native-svg';

// 4-pointed sparkle (사각별). lucide Sparkles와 동일한 실루엣.
export function SparkleIcon({ size = 14, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M12 0.6 Q13 11 20.4 12 Q13 13 12 23.4 Q11 13 3.6 12 Q11 11 12 0.6 Z"
        fill={color}
        stroke={color}
        strokeWidth={1.6}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </Svg>
  );
}
