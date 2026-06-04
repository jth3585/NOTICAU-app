import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONT, WEIGHT } from '../lib/theme';

export default function MyPageScreen() {
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.center}>
        <Text style={styles.label}>마이페이지</Text>
        <Text style={styles.sub}>다음 사이클에서 채워질 예정입니다.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 },
  label: { fontSize: FONT.title, fontWeight: WEIGHT.bold, color: COLORS.text },
  sub: { fontSize: FONT.caption, color: COLORS.textSecondary },
});
