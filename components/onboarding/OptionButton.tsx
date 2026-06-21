import { StyleSheet, Text, View } from 'react-native';
import { COLORS, FONT, RADIUS, SPACING, WEIGHT } from '../../lib/theme';
import { PressableScale } from '../ui/PressableScale';
import { CheckIcon } from '../ui/icons';

type Props = {
  label: string;
  selected: boolean;
  onPress: () => void;
  sublabel?: string;
};

export function OptionButton({ label, selected, onPress, sublabel }: Props) {
  return (
    <PressableScale
      style={[styles.btn, selected && styles.btnSelected]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
    >
      <View style={styles.textCol}>
        <Text style={[styles.label, selected && styles.labelSelected]}>{label}</Text>
        {sublabel ? (
          <Text style={[styles.sublabel, selected && styles.sublabelSelected]}>{sublabel}</Text>
        ) : null}
      </View>
      {selected ? <CheckIcon size={18} color={COLORS.accentText} /> : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: RADIUS.card,
    paddingVertical: SPACING.md + 2,
    paddingHorizontal: SPACING.lg,
    backgroundColor: COLORS.surface,
  },
  btnSelected: {
    borderColor: COLORS.accent,
    backgroundColor: COLORS.accentSoft,
  },
  textCol: { flex: 1 },
  label: {
    fontSize: FONT.body,
    fontWeight: WEIGHT.semibold,
    color: COLORS.text,
  },
  labelSelected: { color: COLORS.accentText },
  sublabel: {
    fontSize: FONT.caption,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  sublabelSelected: { color: COLORS.accentText },
});
