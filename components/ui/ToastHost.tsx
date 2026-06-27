import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONT, RADIUS, SHADOW, SPACING, WEIGHT } from '../../lib/theme';
import { CheckIcon, CloseIcon } from './icons';
import { SortIcon } from './SortIcon';
import { setToastHandler, type ToastType } from '../../lib/toast';

type Item = { id: number; message: string; type: ToastType };
const DURATION_MS = 2000;

// 루트에 1개만 마운트. toast(...) 호출 시 하단에 미니 토스트를 잠깐 띄움.
export function ToastHost() {
  const [item, setItem] = useState<Item | null>(null);
  const insets = useSafeAreaInsets();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idRef = useRef(0);

  useEffect(() => {
    setToastHandler((message, type = 'default') => {
      if (timer.current) clearTimeout(timer.current);
      setItem({ id: ++idRef.current, message, type });
      timer.current = setTimeout(() => setItem(null), DURATION_MS);
    });
    return () => {
      setToastHandler(null);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  if (!item) return null;

  return (
    <View pointerEvents="none" style={[styles.wrap, { bottom: insets.bottom + 72 }]}>
      <Animated.View
        key={item.id}
        entering={FadeInDown.duration(220)}
        exiting={FadeOutDown.duration(180)}
        style={styles.toast}
      >
        {item.type === 'success' ? (
          <CheckIcon size={15} color="#fff" />
        ) : item.type === 'error' ? (
          <CloseIcon size={15} color="#fff" />
        ) : item.type === 'sort' ? (
          <SortIcon size={15} color="#fff" />
        ) : null}
        <Text style={styles.text} numberOfLines={1}>{item.message}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    maxWidth: '88%',
    backgroundColor: COLORS.text, // 다크 pill
    borderRadius: RADIUS.pill,
    paddingVertical: 10,
    paddingHorizontal: SPACING.lg,
    ...SHADOW.card,
  },
  text: { color: '#fff', fontSize: FONT.caption, fontWeight: WEIGHT.semibold },
});
