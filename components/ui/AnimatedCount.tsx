import { useEffect, useState } from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';

// 0 → value 로 부드럽게 세는 숫자. 문장 중간(<Text> 안)에 끼워 쓸 수 있다(중첩 Text).
export function AnimatedCount({
  value,
  style,
  duration = 650,
}: {
  value: number;
  style?: StyleProp<TextStyle>;
  duration?: number;
}) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (value <= 0) { setN(0); return; }
    let raf = 0;
    const start = Date.now();
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setN(Math.round(value * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <Text style={style}>{n}</Text>;
}
