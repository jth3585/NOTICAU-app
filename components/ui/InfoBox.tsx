import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, RADIUS, SPACING } from '../../lib/theme';
import { EdgeLight } from './EdgeLight';

type Tone = 'gradient' | 'accent' | 'danger' | 'default' | keyof typeof COLORS.categories;

const GRADIENT_COLORS = ['#F5F3FF', '#EFF6FF', '#ECFEFF'] as const;

function resolve(tone: Exclude<Tone, 'gradient'>): { bg: string; border: string } {
  if (tone === 'default') return { bg: COLORS.surface2, border: COLORS.border };
  if (tone === 'accent') return { bg: COLORS.accentSoft, border: COLORS.accent };
  if (tone === 'danger') return { bg: COLORS.dangerSoft, border: COLORS.danger };
  const c = COLORS.categories[tone];
  return { bg: c.soft, border: c.main };
}

// 좌측 컬러바 없음. 기본값 gradient (AI 콘텐츠 시각 신호).
export function InfoBox({ children, tone = 'gradient', edgeLight = false }: { children: ReactNode; tone?: Tone; edgeLight?: boolean }) {
  if (tone === 'gradient') {
    return (
      <LinearGradient
        colors={GRADIENT_COLORS}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.box, { borderWidth: 1, borderColor: COLORS.border }]}
      >
        {children}
        {edgeLight ? <EdgeLight radius={RADIUS.box} /> : null}
      </LinearGradient>
    );
  }
  const { bg, border } = resolve(tone);
  return (
    <View style={[styles.box, { backgroundColor: bg, borderWidth: 1, borderColor: border }]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderRadius: RADIUS.box,
    padding: SPACING.lg,
    marginVertical: SPACING.sm,
  },
});
